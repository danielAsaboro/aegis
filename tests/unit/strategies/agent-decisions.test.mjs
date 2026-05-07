/**
 * AgentStrategy verdict-routing tests.
 *
 * These tests do NOT call the live LLM. They construct the strategy with
 * stub dependencies (decideOnPriceMove, runPolicies, executeTrade,
 * runAgentTurn) and assert which branch fires for each verdict shape.
 *
 * Branches covered:
 *   1. hold → no policy run, no execution
 *   2. autonomous + under cap → executeTrade fires directly
 *   3. advisory + under cap → runAgentTurn (tool-loop) fires
 *   4. autonomous + over cap → runAgentTurn (advisory fallback) fires
 *   5. autonomous + under cap but spend-limit denies → no execution, denial notify
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.TELEGRAM_BOT_TOKEN ??= 'test_token';
process.env.ZERION_API_KEY ??= 'test_key';

const { AgentStrategy } = await import('../../../engine/strategies/agent.mjs');
const { SignalType } = await import('../../../engine/core/types.mjs');

function priceDipSignal({ token = 'BONK', chain = 'solana' } = {}) {
  return {
    type: SignalType.PRICE_DIP,
    token,
    chain,
    referencePrice: 0.00002,
    currentPrice: 0.000018,
    dropPercent: 10,
    timestamp: new Date().toISOString(),
  };
}

function makeDeps(overrides = {}) {
  const calls = {
    decide: 0,
    runPolicies: 0,
    executeTrade: 0,
    runAgentTurn: 0,
  };
  const captured = {};
  const deps = {
    decideOnPriceMove: async (sig) => {
      calls.decide += 1;
      captured.signal = sig;
      return overrides.verdict || { action: 'hold', confidence: 'low', reason: 'default-hold' };
    },
    decideOnWhaleMove: async () => overrides.verdict || { decision: 'skip', confidence: 'low', reason: 'default-skip' },
    runPolicies: async (proposal) => {
      calls.runPolicies += 1;
      captured.proposal = proposal;
      return overrides.policyResult || { approved: true, results: [], usePrivate: false };
    },
    executeTrade: async (proposal, opts) => {
      calls.executeTrade += 1;
      captured.executeArgs = { proposal, opts };
      return overrides.executeResult || { success: true, txHash: 'tx-stub-1', estimatedOutput: '1', liquiditySource: 'stub' };
    },
    runAgentTurn: async (args) => {
      calls.runAgentTurn += 1;
      captured.runAgentTurnArgs = args;
      return { text: 'advisory text', toolCalls: [], toolResults: [], response: { messages: [] } };
    },
    withinBudget: async () => true,
    recordInvocation: async () => {},
    getAutonomy: () => overrides.autonomy || 'advisory',
    getMaxAutoExecuteUsd: () => overrides.cap ?? 10,
    getCooldownMs: () => 0,
  };
  return { deps, calls, captured };
}

describe('AgentStrategy verdict routing', () => {
  test('hold verdict → no policy run, no execution, no tool-loop', async () => {
    const { deps, calls } = makeDeps({
      autonomy: 'autonomous',
      verdict: { action: 'hold', confidence: 'high', reason: 'no edge' },
    });
    const notifications = [];
    const strat = new AgentStrategy({ walletName: 'test', deps });
    strat.onNotify((n) => notifications.push(n));

    await strat._handleSignal(priceDipSignal());

    assert.equal(calls.decide, 1, 'verdict generator must be called');
    assert.equal(calls.runPolicies, 0, 'policies must not run on hold');
    assert.equal(calls.executeTrade, 0, 'no execution on hold');
    assert.equal(calls.runAgentTurn, 0, 'no tool-loop on hold');
    assert.equal(notifications.length, 1);
    assert.match(notifications[0].text, /no edge/);
  });

  test('autonomous + under cap → executeTrade fires, no tool-loop', async () => {
    const { deps, calls, captured } = makeDeps({
      autonomy: 'autonomous',
      cap: 10,
      verdict: { action: 'buy', sizeUsd: 5, confidence: 'high', reason: 'good dip' },
    });
    const notifications = [];
    const strat = new AgentStrategy({ walletName: 'test', deps });
    strat.onNotify((n) => notifications.push(n));

    await strat._handleSignal(priceDipSignal());

    assert.equal(calls.runPolicies, 1, 'policies must run on auto-execute');
    assert.equal(calls.executeTrade, 1, 'executeTrade must fire');
    assert.equal(calls.runAgentTurn, 0, 'tool-loop must NOT fire on auto-execute');
    assert.equal(captured.proposal.fromToken, 'USDC');
    assert.equal(captured.proposal.toToken, 'BONK');
    assert.equal(captured.proposal.amount, '5');
    assert.equal(captured.proposal.policyResult?.approved, true, 'policyResult must be attached before executeTrade');
    assert.equal(notifications[0].type, 'executed');
  });

  test('advisory + under cap → runAgentTurn fires (tool-loop path)', async () => {
    const { deps, calls } = makeDeps({
      autonomy: 'advisory',
      cap: 10,
      verdict: { action: 'buy', sizeUsd: 5, confidence: 'high', reason: 'good dip' },
    });
    const strat = new AgentStrategy({ walletName: 'test', deps });

    await strat._handleSignal(priceDipSignal());

    assert.equal(calls.executeTrade, 0, 'advisory must NOT auto-execute');
    assert.equal(calls.runAgentTurn, 1, 'tool-loop path must fire under advisory');
  });

  test('autonomous + over cap → falls back to advisory tool-loop', async () => {
    const { deps, calls } = makeDeps({
      autonomy: 'autonomous',
      cap: 10,
      verdict: { action: 'buy', sizeUsd: 100, confidence: 'high', reason: 'huge dip' },
    });
    const strat = new AgentStrategy({ walletName: 'test', deps });

    await strat._handleSignal(priceDipSignal());

    assert.equal(calls.executeTrade, 0, 'over-cap must NOT auto-execute');
    assert.equal(calls.runAgentTurn, 1, 'over-cap must hand off to tool-loop');
  });

  test('autonomous + under cap but spend-limit denies → no execution, denial notify', async () => {
    const { deps, calls } = makeDeps({
      autonomy: 'autonomous',
      cap: 10,
      verdict: { action: 'buy', sizeUsd: 5, confidence: 'high', reason: 'good dip' },
      policyResult: { approved: false, deniedBy: 'spend-limit', reason: 'over daily cap', results: [] },
    });
    const notifications = [];
    const strat = new AgentStrategy({ walletName: 'test', deps });
    strat.onNotify((n) => notifications.push(n));

    await strat._handleSignal(priceDipSignal());

    assert.equal(calls.runPolicies, 1, 'policies must run');
    assert.equal(calls.executeTrade, 0, 'denied trade must NOT execute');
    assert.equal(notifications[0].type, 'denied');
    assert.equal(notifications[0].deniedBy, 'spend-limit');
  });
});
