/**
 * /ws/logs — server→client tail of every pino log line.
 *
 * The actual tee happens in `engine/core/logger.mjs` via `pino.multistream`
 * when STUDIO_ENABLED=1. Here we just attach to the shared bridge and
 * fan-out to connected sockets.
 */

import { subscribeLogs, getRecentLogs } from '../../core/log-bridge.mjs';

const sockets = new Set();
let bridgeAttached = false;

export function attachLogStream(/* logger */) {
  // No-op kept for API compatibility — wiring is done at logger init.
  // Subscribe a single fan-out fn per process so we don't add a new
  // subscriber every time the studio restarts.
  if (bridgeAttached) return;
  bridgeAttached = true;
  subscribeLogs((line) => {
    for (const ws of sockets) {
      if (ws.readyState === 1) {
        try { ws.send(line); } catch { /* drop */ }
      }
    }
  });
}

export function registerLogSocket(app) {
  attachLogStream();
  app.get('/ws/logs', { websocket: true }, (socket) => {
    sockets.add(socket);
    try {
      socket.send(JSON.stringify({ kind: 'backfill', lines: getRecentLogs(200) }));
    } catch { /* ignore */ }
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));
  });
}
