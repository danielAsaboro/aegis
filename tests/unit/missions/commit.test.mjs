/**
 * Mission service unit tests — commit happy path, missing-policies guard,
 * invalid kind, lifecycle transitions.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

process.env.TELEGRAM_BOT_TOKEN ??= 'test_token';
process.env.ZERION_API_KEY ??= 'test_key';

const TMP = mkdtempSync(join(tmpdir(), 'aegis-missions-'));
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

const {
  commitMission,
  pauseMission,
  resumeMission,
  cancelMission,
  listMissions,
  getMission,
  getMissionEvents,
  recordMissionTrade,
  recordMissionTick,
  findActiveMissionForCall,
  sweepExpiredMissions,
} = await import('../../../engine/missions/index.mjs');

const { MissingPolicyConfigError } = await import('../../../engine/policies/engine.mjs');

describe('Mission.commitMission', () => {
  test('commits a valid mission and writes a committed event', async () => {
    const m = await commitMission({
      userId: 'user-A',
      title: 'DCA SOL',
      intent: 'test',
      kind: 'dca',
      policies: { 'spend-limit': { perTick: 10, daily: 50, total: 200 } },
      budgetUsd: 200,
      perTxCapUsd: 12,
    });
    assert.equal(m.kind, 'dca');
    assert.equal(m.status, 'active');
    assert.equal(m.budgetUsd, 200);
    assert.equal(m.perTxCapUsd, 12);

    const events = await getMissionEvents(m.id);
    assert.ok(events.length >= 1);
    assert.equal(events[events.length - 1].kind, 'committed');
  });

  test('refuses to commit a mission with empty policy bundle', async () => {
    await assert.rejects(
      () => commitMission({
        userId: 'user-B',
        kind: 'agent',
        policies: {},
      }),
      (err) => {
        assert.ok(err instanceof MissingPolicyConfigError);
        return true;
      },
    );
  });

  test('refuses an invalid kind', async () => {
    await assert.rejects(
      () => commitMission({
        userId: 'user-C',
        kind: 'whatever',
        policies: { 'spend-limit': { perTick: 1 } },
      }),
      (err) => {
        assert.match(err.message, /invalid kind/);
        return true;
      },
    );
  });
});

describe('Mission lifecycle', () => {
  test('pause → resume → cancel transitions and event log', async () => {
    const m = await commitMission({
      userId: 'user-D',
      kind: 'agent',
      policies: { 'spend-limit': { perTick: 5 } },
      perTxCapUsd: 5,
    });

    await pauseMission(m.id, 'manual');
    let cur = await getMission(m.id);
    assert.equal(cur.status, 'paused');

    await resumeMission(m.id);
    cur = await getMission(m.id);
    assert.equal(cur.status, 'active');

    await cancelMission(m.id, 'done playing');
    cur = await getMission(m.id);
    assert.equal(cur.status, 'cancelled');

    const events = await getMissionEvents(m.id);
    const kinds = events.map((e) => e.kind);
    assert.ok(kinds.includes('paused'));
    assert.ok(kinds.includes('resumed'));
    assert.ok(kinds.includes('cancelled'));
  });

  test('listMissions filters by user + status', async () => {
    const all = await listMissions({ userId: 'user-D' });
    assert.ok(all.length >= 1);
    const cancelled = await listMissions({ userId: 'user-D', status: 'cancelled' });
    assert.equal(cancelled.length, 1);
  });

  test('findActiveMissionForCall returns the most recent active mission', async () => {
    const m = await commitMission({
      userId: 'user-E',
      kind: 'agent',
      policies: { 'spend-limit': { perTick: 5 } },
      perTxCapUsd: 5,
    });
    const found = await findActiveMissionForCall({ userId: 'user-E', kind: 'agent' });
    assert.ok(found);
    assert.equal(found.id, m.id);
  });
});

describe('Mission budget accounting', () => {
  test('recordMissionTrade increments spentUsd and exhausts the mission', async () => {
    const m = await commitMission({
      userId: 'user-F',
      kind: 'agent',
      policies: { 'spend-limit': { perTick: 100, total: 100 } },
      budgetUsd: 10,
      perTxCapUsd: 5,
    });

    await recordMissionTrade({ missionId: m.id, executionId: 'e1', amountUsd: 4 });
    let cur = await getMission(m.id);
    assert.equal(cur.spentUsd, 4);
    assert.equal(cur.status, 'active');

    await recordMissionTrade({ missionId: m.id, executionId: 'e2', amountUsd: 6 });
    cur = await getMission(m.id);
    assert.equal(cur.spentUsd, 10);
    assert.equal(cur.status, 'exhausted');

    const events = await getMissionEvents(m.id);
    assert.ok(events.some((e) => e.kind === 'exhausted'));
  });

  test('recordMissionTick appends a tick event', async () => {
    const m = await commitMission({
      userId: 'user-G',
      kind: 'dca',
      policies: { 'spend-limit': { perTick: 100 } },
      perTxCapUsd: 50,
    });
    await recordMissionTick({ missionId: m.id, signal: { type: 'DCA_TICK', timestamp: new Date().toISOString() } });
    const events = await getMissionEvents(m.id);
    assert.ok(events.some((e) => e.kind === 'tick'));
  });
});

describe('Mission expiry sweeper', () => {
  test('sweepExpiredMissions transitions past-expiry missions to expired', async () => {
    const m = await commitMission({
      userId: 'user-H',
      kind: 'agent',
      policies: { 'spend-limit': { perTick: 5 } },
      perTxCapUsd: 5,
      expiresAt: new Date(Date.now() - 1000),
    });
    const swept = await sweepExpiredMissions();
    assert.ok(swept >= 1);
    const cur = await getMission(m.id);
    assert.equal(cur.status, 'expired');
  });
});
