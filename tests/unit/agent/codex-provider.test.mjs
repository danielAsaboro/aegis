import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.TELEGRAM_BOT_TOKEN ??= 'test_token';
process.env.ZERION_API_KEY ??= 'test_key';

const codexProvider = await import('../../../engine/agent/providers/codex.mjs');
const { resolveModel } = await import('../../../engine/agent/resolve-model.mjs');

describe('codex AI SDK provider', () => {
  test('codex() returns a LanguageModelV2-shaped object', () => {
    const model = codexProvider.codex('default');
    assert.equal(model.specificationVersion, 'v2');
    assert.equal(model.provider, 'codex');
    assert.equal(model.modelId, 'default');
    assert.ok(typeof model.doGenerate === 'function');
    assert.ok(typeof model.doStream === 'function');
  });

  test('buildCodexPrompt includes transcript roles and tool-call contract', () => {
    const { promptText, warnings } = codexProvider.buildCodexPrompt(
      [
        { role: 'system', content: 'You are AEGIS.' },
        { role: 'user', content: [{ type: 'text', text: 'Check my wallet.' }] },
      ],
      [
        {
          type: 'function',
          name: 'getPortfolio',
          description: 'Read the current wallet portfolio.',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
      undefined,
    );

    assert.equal(Array.isArray(warnings), true);
    assert.match(promptText, /SYSTEM:/);
    assert.match(promptText, /USER:/);
    assert.match(promptText, /Check my wallet\./);
    assert.match(promptText, /```tool_call/);
    assert.match(promptText, /getPortfolio/);
  });

  test('resolveModel routes codex/default through the provider path', async () => {
    const model = await resolveModel('codex/default');
    assert.equal(model.provider, 'codex');
    assert.equal(model.modelId, 'default');
    assert.ok(typeof model.doGenerate === 'function');
  });
});
