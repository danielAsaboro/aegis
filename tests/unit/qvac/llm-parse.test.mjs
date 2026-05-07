/**
 * Tool-call parser tests for the QVAC LLM wrapper.
 *
 * Parses synthetic model outputs in the conventions emitted by Qwen-2.5/3,
 * Hermes-3, Llama-3.1-Instruct, and Mistral-Nemo-Instruct. No model is
 * loaded; this is the deterministic surface we rely on.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.TELEGRAM_BOT_TOKEN ??= 'test_token';
process.env.ZERION_API_KEY ??= 'test_key';

const { parseToolCalls } = await import('../../../engine/qvac/llm.mjs');

describe('QVAC parseToolCalls', () => {
  test('parses single Qwen-style tool_call block', () => {
    const raw = 'Sure, let me check.\n<tool_call>{"name": "getPortfolio", "arguments": {}}</tool_call>';
    const { text, toolCalls } = parseToolCalls(raw);
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0].name, 'getPortfolio');
    assert.deepEqual(toolCalls[0].arguments, {});
    assert.equal(text, 'Sure, let me check.');
  });

  test('parses arguments with nested object', () => {
    const raw = '<tool_call>{"name": "executeSwap", "arguments": {"fromToken":"SOL","toToken":"USDC","amount":"0.5"}}</tool_call>';
    const { toolCalls } = parseToolCalls(raw);
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0].name, 'executeSwap');
    assert.equal(toolCalls[0].arguments.fromToken, 'SOL');
    assert.equal(toolCalls[0].arguments.amount, '0.5');
  });

  test('parses multiple sequential tool_call blocks', () => {
    const raw =
      '<tool_call>{"name": "getSwapQuote", "arguments": {"fromToken":"SOL","toToken":"USDC","amount":"0.1"}}</tool_call>' +
      '<tool_call>{"name": "getPortfolio", "arguments": {}}</tool_call>';
    const { toolCalls } = parseToolCalls(raw);
    assert.equal(toolCalls.length, 2);
    assert.equal(toolCalls[0].name, 'getSwapQuote');
    assert.equal(toolCalls[1].name, 'getPortfolio');
  });

  test('falls back to Mistral [TOOL_CALLS] format', () => {
    const raw = '[TOOL_CALLS][{"name":"getPortfolio","arguments":{}}]';
    const { toolCalls } = parseToolCalls(raw);
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0].name, 'getPortfolio');
  });

  test('parses fenced ```tool_call JSON block (Qwen-friendly format)', () => {
    const raw = 'I will check the portfolio first.\n\n```tool_call\n{"name": "getPortfolio", "arguments": {}}\n```';
    const { text, toolCalls } = parseToolCalls(raw);
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0].name, 'getPortfolio');
    assert.deepEqual(toolCalls[0].arguments, {});
    assert.match(text, /check the portfolio/);
  });

  test('parses fenced ```tool_call with nested args', () => {
    const raw = '```tool_call\n{"name": "executeSwap", "arguments": {"fromToken": "SOL", "toToken": "USDC", "amount": "0.5"}}\n```';
    const { toolCalls } = parseToolCalls(raw);
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0].name, 'executeSwap');
    assert.equal(toolCalls[0].arguments.amount, '0.5');
  });

  test('parses fenced function-style tool_call blocks emitted by Codex', () => {
    const raw = '```tool_call\ngetPortfolio({})\n```';
    const { toolCalls } = parseToolCalls(raw, { idPrefix: 'codex' });
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0].name, 'getPortfolio');
    assert.deepEqual(toolCalls[0].arguments, {});
    assert.match(toolCalls[0].id, /^codex-/);
  });

  test('plain text without tool calls returns empty array', () => {
    const { text, toolCalls } = parseToolCalls('Hello, your portfolio is $1,234.');
    assert.equal(toolCalls.length, 0);
    assert.equal(text, 'Hello, your portfolio is $1,234.');
  });

  test('malformed JSON inside <tool_call> is skipped without throwing', () => {
    const raw = '<tool_call>{not valid json}</tool_call><tool_call>{"name":"ok","arguments":{}}</tool_call>';
    const { toolCalls } = parseToolCalls(raw);
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0].name, 'ok');
  });

  test('alternate field names "parameters" / "tool" are accepted', () => {
    const raw = '<tool_call>{"tool": "listFacts", "parameters": {"category": "preference"}}</tool_call>';
    const { toolCalls } = parseToolCalls(raw);
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0].name, 'listFacts');
    assert.deepEqual(toolCalls[0].arguments, { category: 'preference' });
  });
});
