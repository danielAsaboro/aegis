/**
 * Single shared WebSocket client per channel + useSyncExternalStore
 * subscription. Each channel keeps a bounded ring of recent frames so
 * components mount with content already rendered (no flash-of-empty).
 */

import { useSyncExternalStore } from 'react';
import { wsUrl } from './api';

type Listener = () => void;

class Channel<T> {
  private url: string;
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private buffer: T[] = [];
  private maxSize: number;
  private reconnectTimer: number | null = null;
  private connected = false;

  constructor(url: string, maxSize = 500) {
    this.url = url;
    this.maxSize = maxSize;
  }

  start() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return;
    if (this.socket && this.socket.readyState === WebSocket.CONNECTING) return;
    try {
      this.socket = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket.addEventListener('open', () => {
      this.connected = true;
      this.notify();
    });
    this.socket.addEventListener('message', (ev) => {
      try {
        const parsed = JSON.parse(ev.data);
        if (parsed && parsed.kind === 'backfill') {
          // Backfill replaces the buffer rather than append-after.
          if (Array.isArray((parsed as any).signals)) {
            this.buffer = (parsed as any).signals.slice(-this.maxSize) as T[];
          } else if (Array.isArray((parsed as any).lines)) {
            this.buffer = (parsed as any).lines.slice(-this.maxSize) as T[];
          }
        } else {
          this.push(parsed as T);
        }
      } catch {
        // Pino lines arrive as raw JSON strings (already stringified
        // objects). Logs channel passes them through verbatim.
        this.push(ev.data as T);
      }
      this.notify();
    });
    this.socket.addEventListener('close', () => {
      this.connected = false;
      this.notify();
      this.scheduleReconnect();
    });
    this.socket.addEventListener('error', () => {
      // close handler will fire next.
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.start();
    }, 1500);
  }

  private push(item: T) {
    this.buffer.push(item);
    if (this.buffer.length > this.maxSize) {
      this.buffer.splice(0, this.buffer.length - this.maxSize);
    }
  }

  private notify() {
    for (const l of this.listeners) l();
  }

  subscribe(l: Listener) {
    this.listeners.add(l);
    if (!this.socket) this.start();
    return () => this.listeners.delete(l);
  }

  snapshot() {
    return this.buffer;
  }

  isConnected() {
    return this.connected;
  }
}

let _signalsChan: Channel<any> | null = null;
let _logsChan: Channel<string> | null = null;

function signalsChan() {
  if (!_signalsChan) _signalsChan = new Channel<any>(wsUrl('/ws/signals'), 500);
  return _signalsChan;
}

function logsChan() {
  if (!_logsChan) _logsChan = new Channel<string>(wsUrl('/ws/logs'), 1000);
  return _logsChan;
}

export type SignalFrame = {
  kind?: 'signal';
  signal: { type: string; timestamp: string; [k: string]: any };
};

export function useSignals() {
  const ch = signalsChan();
  const data = useSyncExternalStore(
    (l) => ch.subscribe(l),
    () => ch.snapshot(),
    () => [] as SignalFrame[],
  );
  return data as SignalFrame['signal'][];
}

export function useLogs() {
  const ch = logsChan();
  return useSyncExternalStore(
    (l) => ch.subscribe(l),
    () => ch.snapshot(),
    () => [] as string[],
  );
}

export function useSignalsConnected() {
  const ch = signalsChan();
  return useSyncExternalStore(
    (l) => ch.subscribe(l),
    () => ch.isConnected(),
    () => false,
  );
}
