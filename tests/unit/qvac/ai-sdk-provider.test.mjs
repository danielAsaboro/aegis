/**
 * ai-sdk-qvac provider tests.
 *
 * The model-bound side (doGenerate / doStream) requires a real GGUF and can
 * take minutes on CPU. Keep it out of the default unit suite unless explicitly
 * requested. The pure-function side is exercised unconditionally.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

process.env.TELEGRAM_BOT_TOKEN ??= 'test_token';
process.env.ZERION_API_KEY ??= 'test_key';

const lm = await import('../../../engine/qvac/ai-sdk-provider/language-model.mjs');
const provider = await import('../../../engine/qvac/ai-sdk-provider/provider.mjs');

describe('ai-sdk-qvac — prompt & catalog', () => {
  test('renderToolCatalog produces structured JSON-schema-aware text', () => {
    const catalog = lm.renderToolCatalog([
      {
        type: 'function',
        name: 'getPortfolio',
        description: 'Read the user portfolio.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        type: 'function',
        name: 'executeSwap',
        description: 'Swap tokens.',
        inputSchema: {
          type: 'object',
          properties: {
            fromToken: { type: 'string' },
            toToken: { type: 'string' },
            amount: { type: 'string' },
          },
          required: ['fromToken', 'toToken', 'amount'],
        },
      },
    ]);
    assert.match(catalog, /getPortfolio/);
    assert.match(catalog, /executeSwap/);
    assert.match(catalog, /```tool_call/);
    assert.match(catalog, /fromToken: string/);
  });

  test('renderToolCatalog returns null when no tools', () => {
    assert.equal(lm.renderToolCatalog([]), null);
    assert.equal(lm.renderToolCatalog(undefined), null);
  });

  test('convertPrompt flattens system + user + tool-result trace', () => {
    const v2Prompt = [
      { role: 'system', content: 'You are AEGIS.' },
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 't1', toolName: 'getPortfolio', input: {} },
        ],
      },
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 't1', toolName: 'getPortfolio', output: { type: 'json', value: { total: 1234 } } },
        ],
      },
    ];
    const { messages } = lm.convertPrompt(v2Prompt, null);
    assert.equal(messages[0].role, 'system');
    assert.equal(messages[1].role, 'user');
    assert.match(messages[1].content, /hello/);
    assert.equal(messages[2].role, 'assistant');
    assert.match(messages[2].content, /<tool_call>/);
    assert.equal(messages[3].role, 'tool');
    assert.match(messages[3].content, /1234/);
  });

  test('convertPrompt prepends a synthetic system message when none exists but tools are present', () => {
    const catalog = 'TOOL CATALOG STUB';
    const v2Prompt = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];
    const { messages } = lm.convertPrompt(v2Prompt, catalog);
    assert.equal(messages[0].role, 'system');
    assert.match(messages[0].content, /TOOL CATALOG STUB/);
  });

  test('file parts emit a warning instead of being injected as text', () => {
    const v2Prompt = [
      { role: 'user', content: [
        { type: 'text', text: 'see attached' },
        { type: 'file', mediaType: 'image/png', data: 'AAAA' },
      ] },
    ];
    const { warnings } = lm.convertPrompt(v2Prompt, null);
    assert.ok(warnings.some(w => /file/i.test(w.message)), `expected a file warning, got: ${JSON.stringify(warnings)}`);
  });
});

describe('ai-sdk-qvac — provider factory', () => {
  test('qvac() returns a LanguageModelV2-shaped object', () => {
    const m = provider.qvac('local');
    assert.equal(m.specificationVersion, 'v2');
    assert.equal(m.provider, 'qvac');
    assert.equal(m.modelId, 'local');
    assert.ok(typeof m.doGenerate === 'function');
    assert.ok(typeof m.doStream === 'function');
  });
});

const runLiveQvac = process.env.AEGIS_RUN_QVAC_LIVE_TESTS === '1'
  && process.env.QVAC_LLM_MODEL_PATH
  && existsSync(process.env.QVAC_LLM_MODEL_PATH);

describe('ai-sdk-qvac — live model', { skip: !runLiveQvac }, () => {
  after(async () => {
    const { shutdownSidecar } = await import('../../../engine/qvac/sidecar/client.mjs');
    await shutdownSidecar();
  });

  test('doGenerate returns text content for a trivial prompt', { timeout: 45_000 }, async () => {
    const m = provider.qvac('local');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40_000);
    let result;
    try {
      result = await m.doGenerate({
        prompt: [
          { role: 'system', content: 'You are concise.' },
          { role: 'user', content: [{ type: 'text', text: 'Reply with the single word: ok' }] },
        ],
        abortSignal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const text = result.content.find(p => p.type === 'text')?.text || '';
    assert.ok(text.length > 0, `expected non-empty text, got: ${JSON.stringify(result)}`);
    assert.ok(['stop', 'tool-calls', 'length', 'other'].includes(result.finishReason));
  });
});
