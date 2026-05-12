/**
 * /api/notifications — recent notification history from notify.ndjson.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import env from '../../config.mjs';

export async function registerNotificationRoutes(app) {
  app.get('/api/notifications', async (req) => {
    const take = clamp(Number(req.query?.take) || 50, 1, 500);
    const level = req.query?.level ? String(req.query.level) : null;
    const rows = readNotifications({ take, level });
    return {
      rows,
      count: rows.length,
    };
  });
}

export function readNotifications({ take = 50, level = null } = {}) {
  const file = join(env.DATA_DIR, 'logs', 'notify.ndjson');
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const rows = [];
  for (let idx = lines.length - 1; idx >= 0 && rows.length < take; idx -= 1) {
    try {
      const parsed = JSON.parse(lines[idx]);
      if (level && parsed.level !== level) continue;
      rows.push(parsed);
    } catch {
      // Ignore malformed lines; notify.ndjson is append-only best effort.
    }
  }
  return rows;
}

function clamp(n, lo, hi) {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
