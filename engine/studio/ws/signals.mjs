/**
 * /ws/signals — server→client stream of every event-bus signal.
 *
 * Subscribes to all known SignalType values once. The set of connected
 * sockets receives every emit verbatim as a JSON frame. A small ring
 * buffer keeps the last 200 signals so /api/overview's `recentSignals`
 * and newly-connected clients can backfill without a database read.
 */

import bus from '../../core/event-bus.mjs';
import { SignalType } from '../../core/types.mjs';

const RING_SIZE = 200;
const ring = [];
const sockets = new Set();
let subscribed = false;

function pushRing(frame) {
  ring.push(frame);
  if (ring.length > RING_SIZE) ring.shift();
}

function broadcast(frame) {
  pushRing(frame);
  const payload = JSON.stringify(frame);
  for (const ws of sockets) {
    if (ws.readyState === 1) {
      try { ws.send(payload); } catch { /* drop */ }
    }
  }
}

function ensureSubscribed() {
  if (subscribed) return;
  subscribed = true;
  for (const type of Object.values(SignalType)) {
    bus.subscribe(type, (signal) => {
      broadcast({ kind: 'signal', signal });
    });
  }
}

export function getRecentSignals(n = 10) {
  return ring.slice(-n).map((f) => f.signal).filter(Boolean);
}

export function registerSignalSocket(app) {
  ensureSubscribed();
  app.get('/ws/signals', { websocket: true }, (socket /* , req */) => {
    sockets.add(socket);
    // Backfill — give the client enough history to fill the live feed
    // page on first paint without a separate REST call.
    try {
      socket.send(JSON.stringify({ kind: 'backfill', signals: ring.map((f) => f.signal).filter(Boolean) }));
    } catch { /* ignore */ }

    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));
  });
}
