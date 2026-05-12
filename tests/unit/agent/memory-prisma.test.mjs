/**
 * Prisma-backed memory + budget + facts tests.
 *
 * Spins up a temp sqlite file, runs `prisma db push --skip-generate` against
 * it, then exercises the actual store modules — no mocks.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

process.env.TELEGRAM_BOT_TOKEN ??= 'test_token';
process.env.ZERION_API_KEY ??= 'test_key';

const TMP = mkdtempSync(join(tmpdir(), 'aegis-memory-'));
process.env.DATA_DIR = TMP;
const DB_FILE = join(TMP, 'aegis.db');
process.env.AEGIS_DATABASE_URL = `file:${DB_FILE}`;

let initDb, getPrisma;
let memory, budget;

before(async () => {
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

  ({ initDb, getPrisma } = await import('../../../engine/db/index.mjs'));
  await initDb();

  memory = await import('../../../engine/agent/db-memory.mjs');
  budget = await import('../../../engine/agent/db-budget.mjs');
});

describe('Prisma-backed agent memory', () => {
  test('appendHistory then getHistory round-trips messages with source metadata', async () => {
    const userId = 'user-roundtrip';
    await memory.appendHistory(userId, [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi back' },
    ], { source: 'telegram', chatId: '42', metadata: { turnProfile: 'interactive' } });
    const history = await memory.getHistory(userId);
    assert.equal(history.length, 2);
    assert.equal(history[0].role, 'user');
    assert.equal(history[0].content, 'hello');
    assert.equal(history[0].source, 'telegram');
    assert.equal(history[0].chatId, '42');
    assert.equal(history[0].metadata.turnProfile, 'interactive');
    assert.equal(history[1].role, 'assistant');
    assert.equal(history[1].content, 'hi back');
  });

  test('60-message cap drops oldest FIFO', async () => {
    const userId = 'user-cap';
    const msgs = [];
    for (let i = 0; i < 70; i++) msgs.push({ role: 'user', content: `m${i}` });
    await memory.appendHistory(userId, msgs);

    const history = await memory.getHistory(userId);
    assert.equal(history.length, 60);
    assert.equal(history[0].content, 'm10');
    assert.equal(history[history.length - 1].content, 'm69');
  });

  test('compaction writes durable history summaries into AgentFact', async () => {
    const userId = 'user-summary';
    const msgs = [];
    for (let i = 0; i < 75; i++) {
      msgs.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `turn-${i}` });
    }
    await memory.appendHistory(userId, msgs, { source: 'daemon' });

    const prisma = getPrisma();
    const summaries = await prisma.agentFact.findMany({
      where: { userId, category: 'history-summary' },
      orderBy: { updatedAt: 'desc' },
    });

    assert.ok(summaries.length >= 1);
    assert.match(summaries[0].value, /Session summary/);
    assert.match(summaries[0].value, /\[daemon\] user: turn-0/);
  });

  test('clearHistory deletes only one user', async () => {
    const a = 'user-a';
    const b = 'user-b';
    await memory.appendHistory(a, [{ role: 'user', content: 'a-msg' }]);
    await memory.appendHistory(b, [{ role: 'user', content: 'b-msg' }]);
    await memory.clearHistory(a);
    assert.equal((await memory.getHistory(a)).length, 0);
    assert.equal((await memory.getHistory(b)).length, 1);
  });
});

describe('Prisma-backed budget', () => {
  test('withinBudget true under cap, false above', async () => {
    const key = 'budget-user';
    const prisma = getPrisma();
    const cap = Number(process.env.AEGIS_AGENT_MAX_INVOCATIONS_PER_HOUR || 20);

    // Under cap — should be true.
    assert.equal(await budget.withinBudget(key), true);

    // Insert cap+1 invocation rows; should now be false.
    for (let i = 0; i <= cap; i++) {
      await prisma.agentInvocation.create({
        data: {
          userId: key,
          source: 'test',
          model: 'test',
          status: 'finished',
        },
      });
    }
    assert.equal(await budget.withinBudget(key), false);
  });
});

describe('Prisma-backed facts', () => {
  test('rememberFact upsert + recallFacts filter', async () => {
    const { rememberFact, recallFacts } = await import('../../../engine/agent/tools/facts.mjs');
    const ctx = { experimental_context: { userId: 'fact-user' } };

    await rememberFact.execute({ key: 'stable_pref', value: 'USDC', category: 'preference' }, ctx);
    await rememberFact.execute({ key: 'stable_pref', value: 'USDT', category: 'preference' }, ctx);
    await rememberFact.execute({ key: 'watchlist', value: 'SOL,JUP', category: 'watchlist' }, ctx);

    const all = await recallFacts.execute({}, ctx);
    assert.ok(all.count >= 2);

    const usdtMatch = await recallFacts.execute({ query: 'USDT' }, ctx);
    assert.equal(usdtMatch.count, 1);
    assert.equal(usdtMatch.facts[0].key, 'stable_pref');
    assert.equal(usdtMatch.facts[0].value, 'USDT');

    const watchlist = await recallFacts.execute({ category: 'watchlist' }, ctx);
    assert.equal(watchlist.count, 1);
    assert.equal(watchlist.facts[0].key, 'watchlist');
  });

  test('facts are isolated per userId', async () => {
    const { rememberFact, recallFacts } = await import('../../../engine/agent/tools/facts.mjs');
    await rememberFact.execute({ key: 'private', value: 'alice-only' }, { experimental_context: { userId: 'alice' } });
    const bobView = await recallFacts.execute({ query: 'alice-only' }, { experimental_context: { userId: 'bob' } });
    assert.equal(bobView.count, 0, 'bob must not see alice facts');
  });
});
