/**
 * RAG memory integration test — real Prisma, real embeddings (when the
 * model is present), real ranking. No mocks of any layer.
 *
 * Skipped end-to-end when QVAC_EMBED_MODEL_PATH isn't set; the prep
 * (DB schema + indexer wiring) is still exercised so failures surface
 * even if the model is unavailable in the runner.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

process.env.TELEGRAM_BOT_TOKEN ??= 'test_token';
process.env.ZERION_API_KEY ??= 'test_key';
process.env.QVAC_ENABLE_RAG ??= 'true';

const TMP = mkdtempSync(join(tmpdir(), 'aegis-rag-'));
process.env.DATA_DIR = TMP;
process.env.AEGIS_DATABASE_URL = `file:${join(TMP, 'aegis.db')}`;

let initDb, getPrisma, closeDb, indexFact, searchFacts;
const HAS_EMBED = !!process.env.QVAC_EMBED_MODEL_PATH && existsSync(process.env.QVAC_EMBED_MODEL_PATH);

before(async () => {
  const push = spawnSync('pnpm', ['exec', 'prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    stdio: 'pipe', env: process.env,
  });
  if (push.status !== 0) {
    spawnSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
      stdio: 'pipe', env: process.env,
    });
  }
  ({ initDb, getPrisma, closeDb } = await import('../../engine/db/index.mjs'));
  await initDb();
  ({ indexFact } = await import('../../engine/qvac/indexer.mjs'));
  ({ searchFacts } = await import('../../engine/agent/tools/memory-search.mjs'));
});

after(async () => {
  if (closeDb) await closeDb();
  // Close the QVAC sidecar so node:test can exit even when the live model
  // path was used and the bare subprocess is still holding stdio open.
  try {
    const { shutdownSidecar } = await import('../../engine/qvac/sidecar/client.mjs');
    await shutdownSidecar();
  } catch {}
});

describe('QVAC RAG memory — schema + tools', () => {
  test('AgentFactEmbedding table exists and accepts an upsert', async () => {
    const prisma = getPrisma();
    const fact = await prisma.agentFact.create({
      data: { userId: 'u1', key: 'stable_preference', value: 'USDC for stable holdings' },
    });
    // Synthetic embedding row — ensures schema relation works without the model.
    await prisma.agentFactEmbedding.upsert({
      where: { factId: fact.id },
      update: { model: 'test', dim: 4, vector: Buffer.from([0, 0, 0x80, 0x3f, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) },
      create: { factId: fact.id, model: 'test', dim: 4, vector: Buffer.from([0, 0, 0x80, 0x3f, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) },
    });
    const found = await prisma.agentFactEmbedding.findUnique({ where: { factId: fact.id } });
    assert.equal(found.dim, 4);
    assert.equal(found.vector.length, 16);
    await prisma.agentFactEmbedding.delete({ where: { factId: fact.id } });
    await prisma.agentFact.delete({ where: { id: fact.id } });
  });

  test('searchFacts reports ragAvailable=false when the model is missing', { skip: HAS_EMBED }, async () => {
    process.env.QVAC_EMBED_MODEL_PATH = ''; // ensure unavailable
    const result = await searchFacts.execute({ query: 'preferences' }, { experimental_context: { userId: 'u-missing' } });
    assert.equal(result.success, false);
    assert.equal(result.ragAvailable, false);
    assert.match(result.suggestion || '', /recallFacts/);
  });
});

describe('QVAC RAG memory — live model', { skip: !HAS_EMBED }, () => {
  test('semantic search ranks paraphrase highest', async () => {
    const prisma = getPrisma();
    const userId = 'rag-user';
    const facts = [
      { key: 'stable_preference', value: 'USDC is my stable for holding cash on Solana.' },
      { key: 'dca_size', value: 'My usual DCA buy is 50 USDC into SOL every Tuesday.' },
      { key: 'random_note', value: 'Saw a cool jellyfish documentary last weekend.' },
    ];
    const ids = [];
    for (const f of facts) {
      const row = await prisma.agentFact.upsert({
        where: { userId_key: { userId, key: f.key } },
        update: { value: f.value },
        create: { userId, ...f },
      });
      ids.push(row.id);
      await indexFact(row.id, `${f.key} — ${f.value}`);
    }

    const result = await searchFacts.execute(
      { query: 'what stablecoin do I prefer for cash?', topK: 3 },
      { experimental_context: { userId } },
    );
    assert.equal(result.success, true);
    assert.equal(result.ragAvailable, true);
    assert.ok(result.results.length > 0, 'expected at least one result');
    assert.equal(result.results[0].key, 'stable_preference', `expected stable_preference first, got ${JSON.stringify(result.results)}`);
  });
});
