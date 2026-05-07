/**
 * Daemon socket integration test — boots the IPC server in-process,
 * connects a client, and exchanges one round of list_missions /
 * commit_mission / pause_mission.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';

process.env.TELEGRAM_BOT_TOKEN ??= 'test_token';
process.env.ZERION_API_KEY ??= 'test_key';
process.env.AEGIS_NOTIFY_MACOS = '0';

const TMP = mkdtempSync(join(tmpdir(), 'aegis-ipc-'));
process.env.DATA_DIR = TMP;
process.env.AEGIS_DATABASE_URL = `file:${join(TMP, 'aegis.db')}`;
const SOCK = join(TMP, 'daemon.sock');

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

const { initDb, closeDb } = await import('../../engine/db/index.mjs');
await initDb();

const { startSocketServer, stopSocketServer } = await import('../../engine/ipc/socket.mjs');

await startSocketServer({
  sockPath: SOCK,
  state: { model: 'codex/test', wallet: '0xdeadbeef', startedAt: new Date().toISOString() },
});

function connect() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(SOCK);
    socket.setEncoding('utf8');
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

function readLines(socket, count, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const out = [];
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`timeout after ${out.length} lines`)), timeoutMs);
    socket.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try { out.push(JSON.parse(line)); } catch { /* ignore */ }
        if (out.length >= count) {
          clearTimeout(timer);
          resolve(out);
          return;
        }
      }
    });
    socket.on('error', reject);
  });
}

describe('daemon IPC socket', () => {
  test('client receives ready frame on connect', async () => {
    const socket = await connect();
    const [ready] = await readLines(socket, 1);
    assert.equal(ready.type, 'ready');
    assert.equal(ready.model, 'codex/test');
    socket.end();
  });

  test('list_missions returns mission_list frame', async () => {
    const socket = await connect();
    await readLines(socket, 1); // consume ready
    socket.write(JSON.stringify({ type: 'list_missions' }) + '\n');
    const [reply] = await readLines(socket, 1);
    assert.equal(reply.type, 'mission_list');
    assert.ok(Array.isArray(reply.missions));
    socket.end();
  });

  test('commit_mission persists and broadcasts mission_update', async () => {
    const socket = await connect();
    await readLines(socket, 1); // ready
    socket.write(JSON.stringify({
      type: 'commit_mission',
      userId: 'ipc-user',
      kind: 'agent',
      title: 'IPC test',
      intent: 'integration',
      policies: { 'spend-limit': { perTick: 5 } },
      perTxCapUsd: 5,
    }) + '\n');
    // Daemon broadcasts mission_update first, then sends commit_mission_ok
    // back to the originator. Either order is acceptable; collect 2 lines.
    const replies = await readLines(socket, 2);
    const types = replies.map((r) => r.type).sort();
    assert.deepEqual(types, ['commit_mission_ok', 'mission_update']);
    socket.end();
  });

  test('status command returns daemon state', async () => {
    const socket = await connect();
    await readLines(socket, 1);
    socket.write(JSON.stringify({ type: 'status' }) + '\n');
    const [reply] = await readLines(socket, 1);
    assert.equal(reply.type, 'status');
    assert.equal(reply.model, 'codex/test');
    assert.ok(Array.isArray(reply.missions));
    socket.end();
  });

  test('unknown command returns error frame', async () => {
    const socket = await connect();
    await readLines(socket, 1);
    socket.write(JSON.stringify({ type: 'bogus' }) + '\n');
    const [reply] = await readLines(socket, 1);
    assert.equal(reply.type, 'error');
    socket.end();
  });

  test('cleanup', async () => {
    await stopSocketServer();
    await closeDb();
    assert.ok(true);
  });
});
