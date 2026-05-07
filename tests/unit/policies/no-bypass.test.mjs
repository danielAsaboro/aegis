/**
 * No-bypass test — proves that AEGIS will not execute a trade that hasn't
 * been gated by the policy engine.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

process.env.TELEGRAM_BOT_TOKEN ??= 'test_token';
process.env.ZERION_API_KEY ??= 'test_key';

const TMP = mkdtempSync(join(tmpdir(), 'aegis-policies-'));
process.env.DATA_DIR = TMP;
const DB_FILE = join(TMP, 'aegis.db');
process.env.AEGIS_DATABASE_URL = `file:${DB_FILE}`;

const push = spawnSync(
  'pnpm',
  ['exec', 'prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'],
  { stdio: 'pipe', env: process.env },
);
if (push.status !== 0) {
  spawnSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    stdio: 'pipe', env: process.env,
  });
}

const { initDb } = await import('../../../engine/db/index.mjs');
await initDb();

const { runPolicies, MissingPolicyConfigError } = await import('../../../engine/policies/engine.mjs');
const { executeTrade } = await import('../../../engine/execution/executor.mjs');
const { createTradeProposal } = await import('../../../engine/core/types.mjs');

describe('AEGIS policy bypass guarantees', () => {
  test('runPolicies throws MissingPolicyConfigError on empty policyConfig', async () => {
    const proposal = createTradeProposal({
      strategyId: 'test',
      strategyType: 'manual',
      fromToken: 'USDC',
      toToken: 'SOL',
      amount: 10,
      chain: 'solana',
      reason: 'test',
    });

    await assert.rejects(
      () => runPolicies(proposal, {}),
      (err) => {
        assert.ok(err instanceof MissingPolicyConfigError, 'expected MissingPolicyConfigError');
        assert.equal(err.code, 'missing_policy_config');
        return true;
      },
    );
  });

  test('executeTrade refuses proposal without policyResult', async () => {
    const proposal = createTradeProposal({
      strategyId: 'test',
      strategyType: 'manual',
      fromToken: 'USDC',
      toToken: 'SOL',
      amount: 10,
      chain: 'solana',
      reason: 'test',
    });

    await assert.rejects(
      () => executeTrade(proposal, { walletName: 'nonexistent' }),
      (err) => {
        assert.equal(err.code, 'no_policy_result');
        return true;
      },
    );
  });

  test('executeTrade refuses proposal with un-approved policyResult', async () => {
    const proposal = createTradeProposal({
      strategyId: 'test',
      strategyType: 'manual',
      fromToken: 'USDC',
      toToken: 'SOL',
      amount: 10,
      chain: 'solana',
      reason: 'test',
    });
    proposal.policyResult = { approved: false, deniedBy: 'spend-limit', reason: 'test' };

    await assert.rejects(
      () => executeTrade(proposal, { walletName: 'nonexistent' }),
      (err) => {
        assert.equal(err.code, 'no_policy_result');
        return true;
      },
    );
  });

  test('runPolicies returns approved=true when valid policy passes', async () => {
    const proposal = createTradeProposal({
      strategyId: 'test-pass',
      strategyType: 'manual',
      fromToken: 'USDC',
      toToken: 'SOL',
      amount: 5,
      chain: 'solana',
      reason: 'test',
    });

    const result = await runPolicies(proposal, {
      'spend-limit': { perTick: 100 },
    });
    assert.equal(result.approved, true);
    assert.ok(Array.isArray(result.results));
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].policy, 'spend-limit');
  });

  test('runPolicies denies when spend-limit perTick is exceeded', async () => {
    const proposal = createTradeProposal({
      strategyId: 'test-deny',
      strategyType: 'manual',
      fromToken: 'USDC',
      toToken: 'SOL',
      amount: 500,
      chain: 'solana',
      reason: 'test',
    });

    const result = await runPolicies(proposal, {
      'spend-limit': { perTick: 100 },
    });
    assert.equal(result.approved, false);
    assert.equal(result.deniedBy, 'spend-limit');
  });
});
