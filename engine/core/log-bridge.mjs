/**
 * Shared log bridge — a single Writable that the logger writes to when
 * STUDIO_ENABLED=1, and that the studio's /ws/logs reads from.
 *
 * Lives in core (not studio) to break the import cycle: logger.mjs needs
 * the bridge during pino init, but the studio is what owns the bridge's
 * subscribers. By keeping the bridge here we let logger.mjs import it
 * unconditionally and let studio attach listeners later.
 */

import { Writable } from 'node:stream';

const RING_SIZE = 500;
const ring = [];
const subscribers = new Set();

export const logBridge = new Writable({
  write(chunk, _enc, cb) {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    for (const raw of text.split('\n')) {
      if (raw.length === 0) continue;
      ring.push(raw);
      if (ring.length > RING_SIZE) ring.shift();
      for (const fn of subscribers) {
        try { fn(raw); } catch { /* swallow — never let a bad subscriber kill logging */ }
      }
    }
    cb();
  },
});

export function subscribeLogs(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function getRecentLogs(n = 200) {
  return ring.slice(-n);
}
