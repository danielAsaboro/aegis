/**
 * `zerion daemon` / `aegis daemon` — long-lived service.
 *
 * Subcommands:
 *   start   — fork into the background (or --foreground) and supervise
 *             monitors, strategies, scheduler, mission executor, IPC
 *             socket server.
 *   stop    — SIGTERM via pid file, SIGKILL fallback.
 *   status  — connect to socket, print model/wallet/active missions.
 *   restart — stop + start.
 *   logs    — tail ~/.zerion/aegis/logs/daemon.log
 *
 * State files (under DATA_DIR):
 *   daemon.pid       — daemon PID
 *   daemon.sock      — Unix socket the daemon listens on
 *   logs/daemon.log  — appended stdout/stderr
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, openSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';
import readline from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { print, printError } from '../utils/common/output.js';

const DATA_DIR = process.env.DATA_DIR || join(homedir(), '.zerion', 'aegis');
const PID_PATH = join(DATA_DIR, 'daemon.pid');
const SOCK_PATH = process.env.AEGIS_DAEMON_SOCK || join(DATA_DIR, 'daemon.sock');
const LOG_DIR = join(DATA_DIR, 'logs');
const LOG_PATH = join(LOG_DIR, 'daemon.log');

function ensureDirs() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });
}

function readPid() {
  if (!existsSync(PID_PATH)) return null;
  try {
    const raw = readFileSync(PID_PATH, 'utf8').trim();
    const pid = Number(raw);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function connectSocket(timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(SOCK_PATH);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`socket connect timeout (${SOCK_PATH})`));
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function sendCommand(cmd, { collect = 'reply', timeoutMs = 4000 } = {}) {
  const socket = await connectSocket();
  socket.setEncoding('utf8');
  let buffer = '';
  const messages = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('reply timeout'));
    }, timeoutMs);

    socket.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'ready') continue;
          messages.push(msg);
          if (collect === 'first' || collect === 'reply') {
            clearTimeout(timer);
            socket.end();
            resolve(msg);
            return;
          }
        } catch { /* ignore */ }
      }
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.on('close', () => {
      clearTimeout(timer);
      if (collect === 'all') resolve(messages);
    });

    socket.write(JSON.stringify(cmd) + '\n');
  });
}

async function startDaemon(flags) {
  ensureDirs();
  const existingPid = readPid();
  if (isAlive(existingPid)) {
    print(`daemon already running (pid ${existingPid})`);
    return;
  }

  const entry = fileURLToPath(new URL('../../engine/index.mjs', import.meta.url));
  const env = {
    ...process.env,
    AEGIS_DAEMON: '1',
    AEGIS_DAEMON_SOCK: SOCK_PATH,
    AEGIS_DAEMON_PID_PATH: PID_PATH,
    AEGIS_LOG_STDERR: '1',
  };

  if (flags.foreground) {
    const child = spawn(process.execPath, [entry, 'daemon-supervisor'], {
      stdio: 'inherit',
      env,
    });
    child.on('exit', (code) => process.exit(code ?? 0));
    return;
  }

  const out = openSync(LOG_PATH, 'a');
  const err = openSync(LOG_PATH, 'a');
  const child = spawn(process.execPath, [entry, 'daemon-supervisor'], {
    detached: true,
    stdio: ['ignore', out, err],
    env,
  });
  child.unref();

  // Wait briefly for the socket to appear so we can confirm the daemon is up.
  for (let i = 0; i < 40; i += 1) {
    if (existsSync(SOCK_PATH)) break;
    await sleep(100);
  }
  print(`daemon started (pid ${child.pid}); socket: ${SOCK_PATH}; log: ${LOG_PATH}`);
}

async function stopDaemon() {
  const pid = readPid();
  if (!isAlive(pid)) {
    print('daemon not running');
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    printError('stop_failed', err.message);
    return;
  }
  for (let i = 0; i < 50; i += 1) {
    if (!isAlive(pid)) break;
    await sleep(100);
  }
  if (isAlive(pid)) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
  }
  print(`daemon stopped (pid ${pid})`);
}

async function statusDaemon() {
  const pid = readPid();
  if (!isAlive(pid)) {
    print(JSON.stringify({ running: false }));
    process.exit(1);
  }
  try {
    const reply = await sendCommand({ type: 'status' });
    print(JSON.stringify({ running: true, pid, ...reply }, null, 2));
  } catch (err) {
    print(JSON.stringify({ running: true, pid, socket_error: err.message }));
  }
}

async function logsDaemon(flags) {
  if (!existsSync(LOG_PATH)) {
    print('(no log file yet)');
    return;
  }
  if (!flags.follow && !flags.f) {
    const stream = createReadStream(LOG_PATH);
    stream.pipe(process.stdout);
    await new Promise((resolve) => stream.on('end', resolve));
    return;
  }
  const tail = spawn('tail', ['-n', '100', '-f', LOG_PATH], { stdio: 'inherit' });
  await new Promise((resolve) => tail.on('exit', resolve));
}

async function restartDaemon(flags) {
  await stopDaemon();
  await sleep(200);
  await startDaemon(flags);
}

export default async function daemon(args, flags) {
  const sub = args[0] || 'start';
  switch (sub) {
    case 'start':
      await startDaemon(flags);
      return;
    case 'stop':
      await stopDaemon();
      return;
    case 'status':
      await statusDaemon();
      return;
    case 'restart':
      await restartDaemon(flags);
      return;
    case 'logs':
      await logsDaemon(flags);
      return;
    default:
      printError('unknown_subcommand', `Unknown daemon subcommand: ${sub}`, {
        suggestion: 'try: start | stop | status | restart | logs',
      });
      process.exit(1);
  }
}
