/**
 * Agent no-bypass test — proves the LLM cannot skip the policy gate by
 * sneaking around the chat surface's approval prompt.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

process.env.TELEGRAM_BOT_TOKEN ??= 'test_token';
process.env.ZERION_API_KEY ??= 'test_key';
process.env.DEFAULT_WALLET ??= 'aegis-test-nonexistent';

const TMP = mkdtempSync(join(tmpdir(), 'aegis-no-bypass-'));
process.env.DATA_DIR = TMP;
const DB_FILE = join(TMP, 'aegis.db');
process.env.AEGIS_DATABASE_URL = `file:${DB_FILE}`;

const push = spawnSync(
  'pnpm',
  ['exec', 'prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'],
  { stdio: 'pipe', env: process.env },
);
if (push.status !== 0) {
  // Fallback to npx if pnpm exec fails.
  spawnSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    stdio: 'pipe', env: process.env,
  });
}

const { initDb } = await import('../../../engine/db/index.mjs');
await initDb();

const { allTools } = await import('../../../engine/agent/tools/index.mjs');

describe('LLM cannot bypass the policy gate', () => {
  test('executeSwap returns a structured policy denial when over the perTick limit', async () => {
    const ctx = { experimental_context: { walletName: 'aegis-test-nonexistent', userId: 'llm-test' } };

    const result = await allTools.executeSwap.execute(
      {
        fromToken: 'USDC',
        toToken: 'SOL',
        amount: '1000000',
        chain: 'solana',
        reason: 'attempt to bypass',
      },
      ctx,
    );

    assert.equal(result.success, false, 'oversize trade must not succeed');
    assert.equal(result.denied, true, 'denial flag must be set');
    assert.equal(result.deniedBy, 'spend-limit', 'spend-limit must be the denying policy');
    assert.ok(!result.txHash, 'no txHash should leak from a denied trade');
  });

  test('executeSwap policy gate runs even when called directly (no chat approval)', async () => {
    const ctx = { experimental_context: { walletName: 'aegis-test-nonexistent', userId: 'llm-test' } };

    let result;
    try {
      result = await allTools.executeSwap.execute(
        {
          fromToken: 'USDC',
          toToken: 'SOL',
          amount: '1',
          chain: 'solana',
          reason: 'tiny trade past policy gate',
        },
        ctx,
      );
    } catch (err) {
      assert.notEqual(err.code, 'missing_policy_config', 'policy gate must not be missing');
      assert.notEqual(err.code, 'no_policy_result', 'policy gate must not be skipped');
      return;
    }

    assert.notEqual(result.denied, true, 'a within-limit trade must not be policy-denied');
  });
});
