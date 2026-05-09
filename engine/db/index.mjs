/**
 * Prisma client singleton + DB initialization for AEGIS.
 *
 * AEGIS_DATABASE_URL is resolved as a Prisma URL ("file:..."). When the
 * file path is relative, it's resolved against env.DATA_DIR so the SQLite
 * file lands in the same place as the legacy JSON stores
 * (~/.zerion/aegis/aegis.db by default).
 */

import { mkdirSync } from 'node:fs';
import { isAbsolute, join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import env from '../config.mjs';
import { storeLog } from '../core/logger.mjs';

let _client = null;
let _initPromise = null;

function resolveDatabaseUrl() {
  const raw = process.env.AEGIS_DATABASE_URL || env.AEGIS_DATABASE_URL || 'file:./aegis.db';
  if (!raw.startsWith('file:')) return raw;
  const filePath = raw.slice('file:'.length);
  if (isAbsolute(filePath)) return `file:${filePath}`;
  const cleaned = filePath.replace(/^\.\//, '');
  const dataDir = process.env.DATA_DIR || env.DATA_DIR;
  const abs = join(dataDir, cleaned);
  const dir = dirname(abs);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    throw new Error(
      `DATA_DIR=${dataDir} not writable (failed to create ${dir}: ${err.code || err.message}) — ` +
      `set DATA_DIR to a writable directory (e.g. DATA_DIR=$(mktemp -d)).`
    );
  }
  return `file:${abs}`;
}

export async function initDb() {
  if (_client) return _client;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const url = resolveDatabaseUrl();
    process.env.AEGIS_DATABASE_URL = url;
    _client = new PrismaClient({
      datasources: { db: { url } },
    });
    await _client.$connect();
    storeLog.info({ url: url.replace(/^file:/, 'file:').slice(0, 120) }, 'Prisma connected');

    // Fresh-install guard: if the SQLite file is empty (no schema applied),
    // `prisma db push` is the dev-mode way to seed it. We never run
    // `prisma migrate` per CLAUDE.md.
    if (url.startsWith('file:')) {
      try {
        const rows = await _client.$queryRawUnsafe(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='AgentInvocation' LIMIT 1"
        );
        if (!Array.isArray(rows) || rows.length === 0) {
          storeLog.info({ url }, 'Prisma schema not present — running `prisma db push`');
          pushDbSchema();
        }
      } catch (err) {
        storeLog.warn({ err: err.message }, 'schema presence check failed; attempting db push');
        try { pushDbSchema(); } catch (e) {
          storeLog.warn({ err: e.message }, 'auto db push failed');
        }
      }
    }
    return _client;
  })();

  return _initPromise;
}

export function getPrisma() {
  if (!_client) {
    throw new Error('Prisma client not initialized — call initDb() first.');
  }
  return _client;
}

export async function closeDb() {
  if (!_client) return;
  await _client.$disconnect();
  _client = null;
  _initPromise = null;
}

export function pushDbSchema() {
  const url = resolveDatabaseUrl();
  const commands = [
    ['pnpm', ['exec', 'prisma', 'db', 'push', '--skip-generate', '--accept-data-loss']],
    ['npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss']],
  ];

  for (const [cmd, args] of commands) {
    const child = spawnSync(cmd, args, {
      stdio: 'pipe',
      env: { ...process.env, AEGIS_DATABASE_URL: url },
    });
    if (child.status === 0) return;
  }

  throw new Error(`Failed to apply Prisma schema to ${url}`);
}
