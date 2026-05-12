import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

process.env.TELEGRAM_BOT_TOKEN ??= 'test_token';
process.env.ZERION_API_KEY ??= 'test_key';

const TMP = mkdtempSync(join(tmpdir(), 'aegis-scheduled-'));
process.env.DATA_DIR = TMP;
process.env.AEGIS_DATABASE_URL = `file:${join(TMP, 'aegis.db')}`;

let initDb, closeDb, jobs;

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

  ({ initDb, closeDb } = await import('../../engine/db/index.mjs'));
  await initDb();
  jobs = await import('../../engine/runtime/scheduled-jobs.mjs');
});

describe('scheduled jobs store', () => {
  test('create and list active agent-turn jobs', async () => {
    const created = await jobs.createScheduledJob({
      kind: 'agent_turn',
      scheduleKind: 'every',
      scheduleValue: '300000',
      userId: 'sched-user',
      chatId: '12345',
      prompt: 'Summarize current risk state.',
      payload: { scope: 'risk' },
      title: 'Risk digest',
    });

    assert.equal(created.kind, 'agent_turn');
    assert.equal(created.scheduleKind, 'every');

    const active = await jobs.listActiveScheduledJobs();
    const found = active.find((job) => job.id === created.id);
    assert.ok(found);
    assert.equal(found.chatId, '12345');
    assert.equal(found.payload.scope, 'risk');
  });

  test('recordScheduledJobRun updates run state', async () => {
    const created = await jobs.createScheduledJob({
      kind: 'agent_turn',
      scheduleKind: 'at',
      scheduleValue: new Date(Date.now() + 60_000).toISOString(),
      userId: 'sched-user-2',
      prompt: 'Check wallet drift.',
    });

    const updated = await jobs.recordScheduledJobRun(created.id, {
      nextRunAt: new Date(Date.now() + 120_000).toISOString(),
    });

    assert.ok(updated.lastRunAt);
    assert.ok(updated.nextRunAt);
    assert.equal(updated.lastError, null);
  });

  test('cleanup', async () => {
    await closeDb();
    assert.ok(true);
  });
});
