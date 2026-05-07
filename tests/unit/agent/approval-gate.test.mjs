/**
 * Two-tier approval-gate unit tests:
 *   - within-cap inside an active mission → auto-approve (false)
 *   - above-cap inside an active mission → fall through to human approval (true) + excursion event
 *   - no active mission → fall through to human approval (true)
 *   - mission with no perTxCapUsd → human approval (true)
 *   - unpriceable trade → human approval (true)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

process.env.TELEGRAM_BOT_TOKEN ??= 'test_token';
process.env.ZERION_API_KEY ??= 'test_key';
process.env.AEGIS_NOTIFY_MACOS = '0'; // suppress macOS notifications during tests

const TMP = mkdtempSync(join(tmpdir(), 'aegis-gate-'));
process.env.DATA_DIR = TMP;
process.env.AEGIS_DATABASE_URL = `file:${join(TMP, 'aegis.db')}`;

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

const { needsApprovalGate, estimateAmountUsd } = await import(
  '../../../engine/agent/tools/_approval-gate.mjs'
);
const { commitMission, cancelMission, getMissionEvents } = await import(
  '../../../engine/missions/index.mjs'
);
const { setPrice } = await import('../../../engine/store/state.mjs');

function ctx(userId, toolCallId = 'tcall-1') {
  return {
    toolCallId,
    experimental_context: { userId, source: 'test' },
  };
}

describe('approval gate', () => {
  test('no active mission → falls through to human approval', async () => {
    const gate = needsApprovalGate({ kind: 'agent' });
    const need = await gate(
      { fromToken: 'USDC', toToken: 'SOL', amount: '5', chain: 'solana' },
      ctx('gate-A'),
    );
    assert.equal(need, true);
  });

  test('within-cap stablecoin trade auto-approves', async () => {
    await commitMission({
      userId: 'gate-B',
      kind: 'agent',
      policies: { 'spend-limit': { perTick: 50 } },
      perTxCapUsd: 12,
    });
    const gate = needsApprovalGate({ kind: 'agent' });
    const need = await gate(
      { fromToken: 'USDC', toToken: 'SOL', amount: '10', chain: 'solana' },
      ctx('gate-B'),
    );
    assert.equal(need, false);
  });

  test('above-cap trade prompts human + records excursion event', async () => {
    const m = await commitMission({
      userId: 'gate-C',
      kind: 'agent',
      policies: { 'spend-limit': { perTick: 100 } },
      perTxCapUsd: 5,
    });
    const gate = needsApprovalGate({ kind: 'agent' });
    const need = await gate(
      { fromToken: 'USDC', toToken: 'SOL', amount: '50', chain: 'solana' },
      ctx('gate-C'),
    );
    assert.equal(need, true);
    const events = await getMissionEvents(m.id);
    assert.ok(events.some((e) => e.kind === 'excursion'));
  });

  test('mission without perTxCapUsd always prompts human', async () => {
    await commitMission({
      userId: 'gate-D',
      kind: 'agent',
      policies: { 'spend-limit': { perTick: 100 } },
    });
    const gate = needsApprovalGate({ kind: 'agent' });
    const need = await gate(
      { fromToken: 'USDC', toToken: 'SOL', amount: '1', chain: 'solana' },
      ctx('gate-D'),
    );
    assert.equal(need, true);
  });

  test('non-stablecoin priceable through PriceState cache', async () => {
    await commitMission({
      userId: 'gate-E',
      kind: 'agent',
      policies: { 'spend-limit': { perTick: 1000 } },
      perTxCapUsd: 50,
    });
    await setPrice('SOL', 'solana', 200);
    // 0.2 SOL × $200 = $40, below $50 cap → auto-approve
    const gate = needsApprovalGate({ kind: 'agent' });
    const need = await gate(
      { fromToken: 'SOL', toToken: 'USDC', amount: '0.2', chain: 'solana' },
      ctx('gate-E'),
    );
    assert.equal(need, false);
  });

  test('unpriceable token falls through to human approval', async () => {
    await commitMission({
      userId: 'gate-F',
      kind: 'agent',
      policies: { 'spend-limit': { perTick: 1000 } },
      perTxCapUsd: 50,
    });
    const gate = needsApprovalGate({ kind: 'agent' });
    const need = await gate(
      { fromToken: 'WIF', toToken: 'USDC', amount: '5', chain: 'solana' },
      ctx('gate-F'),
    );
    assert.equal(need, true);
  });
});

describe('estimateAmountUsd helper', () => {
  test('USDC passes through 1:1', async () => {
    const v = await estimateAmountUsd({ fromToken: 'USDC', amount: '12.5', chain: 'solana' });
    assert.equal(v, 12.5);
  });

  test('returns null for unknown token without cached price', async () => {
    const v = await estimateAmountUsd({ fromToken: 'BONK', amount: '100', chain: 'solana' });
    assert.equal(v, null);
  });

  test('uses PriceState for non-stables', async () => {
    await setPrice('ETH', 'ethereum', 3000);
    const v = await estimateAmountUsd({ fromToken: 'ETH', amount: '0.01', chain: 'ethereum' });
    assert.equal(v, 30);
  });
});
