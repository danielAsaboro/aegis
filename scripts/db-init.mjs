#!/usr/bin/env node
/**
 * Apply prisma/schema.prisma to the SQLite database via `prisma db push`.
 *
 * Resolves AEGIS_DATABASE_URL the same way engine/db/index.mjs does so that
 * relative URLs land in DATA_DIR.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { isAbsolute, join, dirname } from 'node:path';
import env from '../engine/config.mjs';

function resolveDatabaseUrl() {
  const raw = env.AEGIS_DATABASE_URL || 'file:./aegis.db';
  if (!raw.startsWith('file:')) return raw;
  const filePath = raw.slice('file:'.length);
  if (isAbsolute(filePath)) return `file:${filePath}`;
  const cleaned = filePath.replace(/^\.\//, '');
  const abs = join(env.DATA_DIR, cleaned);
  mkdirSync(dirname(abs), { recursive: true });
  return `file:${abs}`;
}

const url = resolveDatabaseUrl();
const child = spawnSync(
  'pnpm',
  ['exec', 'prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'],
  {
    stdio: 'inherit',
    env: { ...process.env, AEGIS_DATABASE_URL: url },
  },
);

if (child.status !== 0) {
  process.exit(child.status || 1);
}
