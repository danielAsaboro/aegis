/**
 * Sidecar client — vendored from AEGIS for the published `ai-sdk-qvac`
 * package. Spawns the Bare-runtime sidecar (sidecar.cjs) once on first
 * use and multiplexes JSON-RPC requests over stdin/stdout.
 *
 * Why a sidecar: QVAC native bindings call `require.addon()` which only
 * exists on the Bare runtime. A Node host can't load them directly. The
 * sidecar bridges that gap with no shims and no mocks — both halves run
 * the real packages on the runtimes they were built for.
 *
 * Wire protocol (line-delimited JSON):
 *   request:  {"id":"<uuid>","op":"embed|transcribe|tts|llm-chat|llm-cancel|unload|ping", ...}
 *   response: {"id":"<uuid>","ok":true,"result":...}
 *           | {"id":"<uuid>","ok":false,"error":{"message":"...","code":"..."}}
 *           | {"id":"<uuid>","event":"<name>","data":...}    (intermediate stream events)
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createLogger } from '../_logger.mjs';

const log = createLogger('sidecar');
const require_ = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIDECAR_SCRIPT = join(__dirname, 'sidecar.cjs');

function resolveBareBinary() {
  try {
    const pkgPath = require_.resolve('bare-runtime/package.json');
    const candidate = join(dirname(pkgPath), 'bin', 'bare');
    if (existsSync(candidate)) return candidate;
  } catch {}
  const cwd = process.cwd();
  const local = join(cwd, 'node_modules', '.bin', 'bare');
  if (existsSync(local)) return local;
  return null;
}

export class SidecarUnavailableError extends Error {
  constructor(reason) {
    super(`QVAC sidecar unavailable: ${reason}`);
    this.code = 'qvac_sidecar_unavailable';
    this.reason = reason;
  }
}

export class QvacSidecar extends EventEmitter {
  constructor() {
    super();
    this._proc = null;
    this._spawnPromise = null;
    this._buf = '';
    this._pending = new Map();
    this._readyResolve = null;
    this._readyPromise = null;
    this._exited = false;
    this._exitInfo = null;
  }

  isAlive() {
    return !!this._proc && !this._exited;
  }

  async _spawn() {
    if (this._proc) return;
    if (this._spawnPromise) return this._spawnPromise;
    this._spawnPromise = (async () => {
      const bin = resolveBareBinary();
      if (!bin) {
        throw new SidecarUnavailableError(
          'bare-runtime binary not found. Install bare-runtime + the matching bare-runtime-<platform>-<arch> package as peerDependencies.',
        );
      }
      if (!existsSync(SIDECAR_SCRIPT)) {
        throw new SidecarUnavailableError(`sidecar script missing at ${SIDECAR_SCRIPT}`);
      }

      this._readyPromise = new Promise((res) => { this._readyResolve = res; });

      const child = spawn(bin, [SIDECAR_SCRIPT], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => this._onStdout(chunk));
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        const s = chunk.toString().trim();
        if (s) log.debug({ stream: 'stderr' }, s);
      });
      child.on('exit', (code, signal) => this._onExit(code, signal));
      child.on('error', (err) => this._onError(err));

      this._proc = child;

      const timeout = setTimeout(() => {
        if (this._readyResolve) {
          const r = this._readyResolve;
          this._readyResolve = null;
          this._readyPromise = null;
          r(new SidecarUnavailableError('sidecar did not signal ready within 30s'));
        }
      }, 30_000);
      const readyOrErr = await this._readyPromise;
      clearTimeout(timeout);
      if (readyOrErr instanceof Error) {
        await this.shutdown(true);
        throw readyOrErr;
      }
      log.info({ pid: child.pid }, 'QVAC sidecar ready');
    })().finally(() => { this._spawnPromise = null; });
    return this._spawnPromise;
  }

  _onStdout(chunk) {
    this._buf += chunk;
    let idx;
    while ((idx = this._buf.indexOf('\n')) >= 0) {
      const line = this._buf.slice(0, idx).trim();
      this._buf = this._buf.slice(idx + 1);
      if (!line) continue;
      let frame;
      try { frame = JSON.parse(line); }
      catch (err) {
        log.warn({ err: err.message, line: line.slice(0, 160) }, 'invalid JSON from sidecar');
        continue;
      }
      this._dispatchFrame(frame);
    }
  }

  _dispatchFrame(frame) {
    if (!frame.id) {
      if (frame.event === 'ready' && this._readyResolve) {
        const r = this._readyResolve;
        this._readyResolve = null;
        this._readyPromise = null;
        r(true);
      }
      this.emit(frame.event || 'frame', frame);
      return;
    }
    const pending = this._pending.get(frame.id);
    if (!pending) {
      log.debug({ id: frame.id }, 'frame for unknown request id');
      return;
    }
    if (frame.event !== undefined) {
      try { pending.onEvent?.(frame.event, frame.data); }
      catch (err) { log.warn({ err: err.message }, 'onEvent threw'); }
      return;
    }
    this._pending.delete(frame.id);
    if (frame.ok) {
      pending.resolve(frame.result);
    } else {
      const err = new Error(frame.error?.message || 'sidecar error');
      err.code = frame.error?.code || 'qvac_sidecar_error';
      pending.reject(err);
    }
  }

  _onError(err) {
    log.error({ err: err.message }, 'sidecar process error');
    if (this._readyResolve) {
      const r = this._readyResolve;
      this._readyResolve = null;
      this._readyPromise = null;
      r(new SidecarUnavailableError(`spawn error: ${err.message}`));
    }
    this._failAllPending(err);
  }

  _onExit(code, signal) {
    this._exited = true;
    this._exitInfo = { code, signal };
    log.warn({ code, signal }, 'sidecar exited');
    if (this._readyResolve) {
      const r = this._readyResolve;
      this._readyResolve = null;
      this._readyPromise = null;
      r(new SidecarUnavailableError(`sidecar exited (code=${code}, signal=${signal}) before ready`));
    }
    this._failAllPending(new Error(`sidecar exited (code=${code}, signal=${signal})`));
    this._proc = null;
  }

  _failAllPending(err) {
    for (const [, pending] of this._pending) {
      pending.reject(err);
    }
    this._pending.clear();
  }

  async request(op, payload = {}, { onEvent, signal } = {}) {
    await this._spawn();
    if (!this._proc) throw new SidecarUnavailableError('sidecar not started');

    const id = randomUUID();
    const frame = { id, op, ...payload };
    const json = JSON.stringify(frame);
    if (json.length > 64 * 1024 * 1024) {
      throw new Error('request too large for stdio JSON transport');
    }

    return await new Promise((resolve, reject) => {
      const onAbort = () => {
        if (this._pending.delete(id)) {
          const err = Object.assign(new Error('request aborted'), { name: 'AbortError', code: 'AbortError' });
          if (op === 'llm-chat') this.request('llm-cancel').catch(() => {});
          reject(err);
        }
      };
      if (signal) {
        if (signal.aborted) {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError', code: 'AbortError' }));
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
      this._pending.set(id, {
        resolve: (v) => { signal?.removeEventListener('abort', onAbort); resolve(v); },
        reject: (e) => { signal?.removeEventListener('abort', onAbort); reject(e); },
        onEvent,
      });
      try {
        this._proc.stdin.write(json + '\n');
      } catch (err) {
        this._pending.delete(id);
        reject(new SidecarUnavailableError(`stdin write failed: ${err.message}`));
      }
    });
  }

  async shutdown(force = false) {
    if (!this._proc) return;
    try {
      if (!force) {
        try { this._proc.stdin.end(); } catch {}
        await new Promise(res => {
          if (this._exited) return res();
          this._proc.once('exit', () => res());
          setTimeout(() => res(), 5_000);
        });
      }
      if (!this._exited) {
        try { this._proc.kill('SIGTERM'); } catch {}
      }
    } finally {
      this._proc = null;
      this._exited = true;
    }
  }
}

let _singleton = null;
export function getSidecar() {
  if (!_singleton) _singleton = new QvacSidecar();
  return _singleton;
}

export async function shutdownSidecar() {
  if (_singleton) {
    await _singleton.shutdown();
    _singleton = null;
  }
}
