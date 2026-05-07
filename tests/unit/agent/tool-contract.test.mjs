/**
 * Tool registry contract tests.
 *
 * These tests do NOT call the LLM. They invoke each tool's execute()
 * directly with structured input and assert the shape of the returned
 * value. Network-dependent tools are tagged so they can be skipped under
 * OFFLINE=1 without hiding their existence.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.TELEGRAM_BOT_TOKEN ??= 'test_token';
process.env.ZERION_API_KEY ??= 'test_key';

const { allTools } = await import('../../../engine/agent/tools/index.mjs');

const EXPECTED = [
  'getPortfolio',
  'getPositions',
  'getPnl',
  'getHistory',
  'getTokenPrice',
  'searchToken',
  'listChains',
  'getSwapQuote',
  'executeSwap',
  'createDCAPlan',
  'listDCAPlans',
  'pauseDCAPlan',
  'cancelDCAPlan',
  'listAvailablePolicies',
  'showActivePolicies',
  'getDefaultPoliciesForStrategy',
  'getShieldBalance',
  'depositToShield',
  'withdrawFromShield',
  'listWallets',
  'getWalletAddresses',
  'rememberFact',
  'recallFacts',
  'forgetFact',
  'listFacts',
];

const NEEDS_APPROVAL = new Set([
  'executeSwap',
  'createDCAPlan',
  'depositToShield',
  'withdrawFromShield',
]);

const FACTS_TOOLS = ['rememberFact', 'recallFacts', 'forgetFact', 'listFacts'];

describe('tool registry contract', () => {
  test('every expected tool is present', () => {
    for (const name of EXPECTED) {
      assert.ok(allTools[name], `missing tool: ${name}`);
    }
  });

  test('every tool has description, inputSchema, execute', () => {
    for (const [name, t] of Object.entries(allTools)) {
      assert.ok(t.description, `tool ${name} missing description`);
      assert.equal(typeof t.execute, 'function', `tool ${name} missing execute`);
      assert.ok(t.inputSchema !== undefined, `tool ${name} missing inputSchema`);
    }
  });

  test('every value-moving tool requires approval (boolean true OR dynamic gate function)', () => {
    for (const name of NEEDS_APPROVAL) {
      const gate = allTools[name].needsApproval;
      const ok = gate === true || typeof gate === 'function';
      assert.ok(ok, `tool ${name} must have needsApproval=true or a gate function (got ${typeof gate})`);
    }
  });

  test('read-only tools do NOT require approval', () => {
    const readOnly = EXPECTED.filter(n => !NEEDS_APPROVAL.has(n));
    for (const name of readOnly) {
      const gate = allTools[name].needsApproval;
      const requiresApproval = gate === true || typeof gate === 'function';
      assert.ok(!requiresApproval, `read-only tool ${name} should not require approval`);
    }
  });

  test('facts tools do NOT require approval', () => {
    for (const name of FACTS_TOOLS) {
      assert.ok(allTools[name], `missing facts tool: ${name}`);
      assert.notEqual(allTools[name].needsApproval, true, `facts tool ${name} should not require approval`);
    }
  });
});

describe('listAvailablePolicies (offline)', () => {
  test('returns the policy list from engine', async () => {
    const out = await allTools.listAvailablePolicies.execute({}, {});
    assert.ok(Array.isArray(out.policies));
    assert.ok(out.policies.length >= 4);
    const ids = out.policies.map(p => p.id);
    for (const must of ['spend-limit', 'cooldown', 'price-guard']) {
      assert.ok(ids.includes(must), `policy list missing ${must}`);
    }
  });
});

describe('showActivePolicies (offline)', () => {
  test('returns a config object for known strategy', async () => {
    const out = await allTools.showActivePolicies.execute({ strategy: 'dca' }, {});
    assert.equal(out.strategy, 'dca');
    assert.ok(out.config);
    assert.ok(out.config['spend-limit']);
  });
});

describe('listChains (offline)', () => {
  test('returns the supported-chains list', async () => {
    const out = await allTools.listChains.execute({}, {});
    assert.ok(Array.isArray(out.chains));
    assert.ok(out.chains.includes('solana'));
  });
});
