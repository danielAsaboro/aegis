#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LOCAL_ROOT = join(ROOT, '.surfpool', 'aegis-local');
const LOCAL_HOME = join(LOCAL_ROOT, 'home');
const LOCAL_DATA = join(LOCAL_ROOT, 'data');
const LOCAL_LOG = join(LOCAL_ROOT, 'surfpool.log');
const LOCAL_DB = 'file:./aegis-local.db';
const SURFPOOL_URL = 'http://127.0.0.1:8899';
const LOCAL_SOCK = '/tmp/aegis-local-daemon.sock';
const LOCAL_DAEMON_LOG = join(LOCAL_ROOT, 'daemon.log');
const LOCAL_WALLET = 'proof-local';
const LOCAL_POLICY_NAME = 'surfpool-local-solana-24h';
const LOCAL_TOKEN_NAME = 'proof-local-token';
const AIRDROP_SOL = 1;
const DEFAULT_SWAP_AMOUNT = '0.001';
const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const DEFAULT_AGENT_MESSAGE = 'Swap 0.001 SOL to USDC on Solana.';

function candidateQvacModels() {
  return [
    process.env.QVAC_LLM_MODEL_PATH,
    join(homedir(), '.cache', 'aegis', 'qvac', 'qwen2.5-7b-instruct-q3_k_m.gguf'),
    join(homedir(), '.cache', 'aegis', 'qvac', 'qwen2.5-1.5b-instruct-q4_k_m.gguf'),
  ].filter(Boolean);
}

function resolveLocalQvacModelPath() {
  for (const path of candidateQvacModels()) {
    if (existsSync(path)) return path;
  }
  return '';
}

function parseArgs(argv) {
  const [command = 'bootstrap', ...rest] = argv;
  const flags = {};
  const positional = [];
  for (const arg of rest) {
    if (arg.startsWith('--')) {
      const trimmed = arg.slice(2);
      const eq = trimmed.indexOf('=');
      if (eq >= 0) flags[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
      else flags[trimmed] = true;
    } else {
      positional.push(arg);
    }
  }
  return { command, flags, positional };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function assertEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function loadKeypairFromEnv() {
  const raw = assertEnv('SOLANA_PRIVATE_KEY');
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return Keypair.fromSecretKey(Uint8Array.from(parsed));
  } catch {}
  throw new Error('SOLANA_PRIVATE_KEY must be a JSON byte array for local surfpool mode');
}

function localEnv(overrides = {}) {
  const qvacModelPath = resolveLocalQvacModelPath();
  return {
    ...process.env,
    HOME: LOCAL_HOME,
    USERPROFILE: LOCAL_HOME,
    DATA_DIR: LOCAL_DATA,
    AEGIS_DATABASE_URL: LOCAL_DB,
    SOLANA_RPC_URL: SURFPOOL_URL,
    DEFAULT_CHAIN: 'solana',
    DEFAULT_WALLET: LOCAL_WALLET,
    AEGIS_LOG_STDERR: '1',
    AEGIS_LOCAL_SURFPOOL_MODE: '1',
    AEGIS_AGENT_MODEL: qvacModelPath ? 'qvac/local' : (process.env.AEGIS_AGENT_MODEL || 'codex/default'),
    QVAC_LLM_MODEL_PATH: qvacModelPath || process.env.QVAC_LLM_MODEL_PATH || '',
    ...overrides,
  };
}

function installLocalEnv() {
  const env = localEnv();
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
}

async function waitForRpc(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(SURFPOOL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getVersion', params: [] }),
        signal: AbortSignal.timeout(2_000),
      });
      if (res.ok) return true;
    } catch {}
    await delay(500);
  }
  return false;
}

async function waitForSocket(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection(LOCAL_SOCK);
        socket.once('connect', () => {
          socket.end();
          resolve();
        });
        socket.once('error', reject);
      });
      return true;
    } catch {}
    await delay(250);
  }
  return false;
}

async function ensureSurfpool(pubkey) {
  mkdirSync(LOCAL_ROOT, { recursive: true });
  if (await waitForRpc(2_000)) return { started: false, rpcUrl: SURFPOOL_URL };

  const logFd = openSync(LOCAL_LOG, 'a');
  const proc = spawn(
    'surfpool',
    ['start', '--network', 'mainnet', '--no-tui', '--airdrop', pubkey],
    {
      cwd: ROOT,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: localEnv(),
    }
  );
  proc.unref();

  if (!(await waitForRpc(30_000))) {
    throw new Error(`surfpool RPC at ${SURFPOOL_URL} not reachable after startup. See ${LOCAL_LOG}`);
  }
  return { started: true, rpcUrl: SURFPOOL_URL, logFile: LOCAL_LOG };
}

async function ensureLocalBalance(keypair) {
  const conn = new Connection(SURFPOOL_URL, 'confirmed');
  const beforeLamports = await conn.getBalance(keypair.publicKey);
  if (beforeLamports > 0) {
    return { beforeLamports, afterLamports: beforeLamports, airdropped: false };
  }
  const sig = await conn.requestAirdrop(keypair.publicKey, AIRDROP_SOL * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, 'confirmed');
  const afterLamports = await conn.getBalance(keypair.publicKey);
  return { beforeLamports, afterLamports, airdropped: true, airdropSignature: sig };
}

async function ensureUsdcAta(keypair) {
  const { PublicKey } = await import('@solana/web3.js');
  const { createAssociatedTokenAccountIdempotent, getAssociatedTokenAddressSync } =
    await import('@solana/spl-token');
  const conn = new Connection(SURFPOOL_URL, 'confirmed');
  const mint = new PublicKey(SOLANA_USDC_MINT);
  const ata = getAssociatedTokenAddressSync(mint, keypair.publicKey);
  await createAssociatedTokenAccountIdempotent(conn, keypair, mint, keypair.publicKey, { commitment: 'confirmed' });
  return ata.toBase58();
}

function ensureLocalDb() {
  const child = spawnSync(process.execPath, ['scripts/db-init.mjs'], {
    cwd: ROOT,
    env: localEnv(),
    stdio: 'pipe',
    encoding: 'utf8',
  });
  if (child.status !== 0) {
    throw new Error(
      `local db bootstrap failed: ${child.stderr || child.stdout || `exit ${child.status}`}`
    );
  }
}

function policyExpiryTimestamp(policy) {
  const rule = (policy.rules || []).find((r) => r.type === 'expires_at');
  return rule?.timestamp || null;
}

function policyAllowsSolana(policy, toCaip2) {
  const rule = (policy.rules || []).find((r) => r.type === 'allowed_chains');
  return Array.isArray(rule?.chain_ids) && rule.chain_ids.includes(toCaip2('solana'));
}

async function bootstrapLocalMode() {
  const keypair = loadKeypairFromEnv();
  mkdirSync(LOCAL_HOME, { recursive: true });
  mkdirSync(LOCAL_DATA, { recursive: true });

  const surfpool = await ensureSurfpool(keypair.publicKey.toBase58());
  installLocalEnv();

  const [
    keystore,
    config,
  ] = await Promise.all([
    import('../cli/utils/wallet/keystore.js'),
    import('../cli/utils/config.js'),
  ]);
  ensureLocalDb();

  const matchingWallets = keystore.listWallets().filter((candidate) => candidate.name === LOCAL_WALLET);
  if (
    matchingWallets.length > 1 ||
    (matchingWallets.length === 1 && matchingWallets[0].solAddress !== keypair.publicKey.toBase58())
  ) {
    for (const candidate of matchingWallets) {
      try { keystore.deleteWallet(candidate.id || candidate.name); } catch {}
    }
  }

  let wallet = keystore.listWallets().find((candidate) => candidate.name === LOCAL_WALLET);
  if (!wallet) {
    wallet = keystore.importFromKey(LOCAL_WALLET, process.env.SOLANA_PRIVATE_KEY, '', 'solana');
  }

  config.setWalletOrigin(LOCAL_WALLET, 'sol-key');
  config.setConfigValue('defaultWallet', LOCAL_WALLET);
  config.setConfigValue('defaultChain', 'solana');

  const policies = keystore.listPolicies();
  const now = Date.now();
  let policy = policies.find((candidate) =>
    candidate.name === LOCAL_POLICY_NAME &&
    policyAllowsSolana(candidate, keystore.toCaip2) &&
    (!policyExpiryTimestamp(candidate) || Date.parse(policyExpiryTimestamp(candidate)) > now)
  );

  if (!policy) {
    policy = keystore.createPolicy(
      `policy-surfpool-local-${Date.now().toString(36)}`,
      LOCAL_POLICY_NAME,
      [
        { type: 'allowed_chains', chain_ids: [keystore.toCaip2('solana')] },
        { type: 'expires_at', timestamp: new Date(now + 24 * 3600_000).toISOString() },
      ],
      null,
      null
    );
  }

  for (const token of keystore.listAgentTokens()) {
    const wid = token.walletIds?.[0];
    if (wid && keystore.getWalletNameById(wid) === LOCAL_WALLET) {
      try { keystore.revokeAgentToken(token.id || token.name); } catch {}
    }
  }

  const token = keystore.createAgentToken(
    LOCAL_TOKEN_NAME,
    LOCAL_WALLET,
    '',
    new Date(now + 24 * 3600_000).toISOString(),
    [policy.id]
  );
  config.saveAgentToken(LOCAL_WALLET, token.token);

  const balance = await ensureLocalBalance(keypair);
  const usdcAta = await ensureUsdcAta(keypair);

  return {
    rpcUrl: SURFPOOL_URL,
    surfpool,
    walletName: LOCAL_WALLET,
    walletAddress: wallet.solAddress,
    agentModel: process.env.AEGIS_AGENT_MODEL,
    qvacModelPath: process.env.QVAC_LLM_MODEL_PATH || null,
    policyId: policy.id,
    tokenName: token.name,
    localHome: LOCAL_HOME,
    localDataDir: LOCAL_DATA,
    balanceSol: balance.afterLamports / LAMPORTS_PER_SOL,
    airdropped: balance.airdropped,
    airdropSignature: balance.airdropSignature || null,
    usdcAta,
  };
}

function runNode(args, { capture = false, extraEnv = {} } = {}) {
  const child = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: localEnv(extraEnv),
    stdio: capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
  });
  if (capture) {
    return {
      status: child.status || 0,
      stdout: child.stdout || '',
      stderr: child.stderr || '',
    };
  }
  if (child.status !== 0) process.exit(child.status || 1);
  return { status: 0 };
}

async function withDb(fn) {
  installLocalEnv();
  ensureLocalDb();
  const { initDb, closeDb } = await import('../engine/db/index.mjs');
  await initDb();
  try {
    return await fn();
  } finally {
    await closeDb().catch(() => {});
  }
}

async function runBootstrap(flags) {
  const summary = await bootstrapLocalMode();
  if (flags.json) printJson(summary);
  else {
    process.stdout.write(
      `surfpool local mode ready\n` +
      `wallet: ${summary.walletName} (${summary.walletAddress})\n` +
      `rpc:    ${summary.rpcUrl}\n` +
      `home:   ${summary.localHome}\n` +
      `data:   ${summary.localDataDir}\n` +
      `bal:    ${summary.balanceSol.toFixed(4)} SOL\n`
    );
  }
}

async function runSwap(flags) {
  await bootstrapLocalMode();
  const amount = flags.amount || DEFAULT_SWAP_AMOUNT;
  const fromToken = flags.from || 'SOL';
  const toToken = flags.to || 'USDC';
  const args = ['cli/zerion.js', 'swap', 'solana', amount, fromToken, toToken, '--wallet', LOCAL_WALLET];
  if (flags.json) args.push('--json');
  if (flags.slippage) args.push('--slippage', String(flags.slippage));
  if (flags.timeout) args.push('--timeout', String(flags.timeout));
  const result = runNode(args, { capture: !!flags.json });
  if (flags.json) {
    if (result.status !== 0) {
      process.stderr.write(result.stderr);
      process.exit(result.status);
    }
    process.stdout.write(result.stdout);
  }
}

async function ensureLocalDaemon(flags = {}) {
  await bootstrapLocalMode();
  if (await waitForSocket(500)) {
    return { socketPath: LOCAL_SOCK, started: false, model: process.env.AEGIS_AGENT_MODEL };
  }

  mkdirSync(LOCAL_ROOT, { recursive: true });
  const logFd = openSync(LOCAL_DAEMON_LOG, 'a');
  const args = ['cli/zerion.js', 'daemon', 'start'];
  if (flags.foreground) args.push('--foreground');

  if (flags.foreground) {
    runNode(args, { extraEnv: { AEGIS_DAEMON_SOCK: LOCAL_SOCK } });
    return { socketPath: LOCAL_SOCK, started: true, model: process.env.AEGIS_AGENT_MODEL };
  }

  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: localEnv({ AEGIS_DAEMON_SOCK: LOCAL_SOCK }),
  });
  child.unref();

  if (!(await waitForSocket(15_000))) {
    throw new Error(`local daemon socket at ${LOCAL_SOCK} not reachable after startup. See ${LOCAL_DAEMON_LOG}`);
  }
  return { socketPath: LOCAL_SOCK, started: true, model: process.env.AEGIS_AGENT_MODEL, logFile: LOCAL_DAEMON_LOG };
}

async function stopLocalDaemon() {
  await bootstrapLocalMode();
  runNode(['cli/zerion.js', 'daemon', 'stop'], { extraEnv: { AEGIS_DAEMON_SOCK: LOCAL_SOCK } });
}

function formatSocketEvent(event) {
  if (event.type === 'response') return `agent: ${event.text}`;
  if (event.type === 'tool_start') return `→ ${event.toolName}`;
  if (event.type === 'tool_finish') return `${event.success ? '✓' : '✗'} ${event.toolName}${event.durationMs ? ` ${event.durationMs}ms` : ''}`;
  if (event.type === 'tool_error') return `✗ ${event.toolName}${event.errorMsg ? ` — ${event.errorMsg}` : ''}`;
  if (event.type === 'approval_request') return `approval: ${event.toolName}`;
  if (event.type === 'turn_complete') return 'turn complete';
  if (event.type === 'turn_error') return `turn error: ${event.errorMsg || 'unknown error'}`;
  if (event.type === 'execution') return `execution: ${event.success ? 'success' : 'failed'}`;
  if (event.type === 'notification') return `notification: ${event.title || event.level || 'info'}`;
  if (event.type === 'error') return `error: ${event.message}`;
  return `${event.type}`;
}

async function sendDaemonMessage({ text, autoApprove = false, json = false, sessionId = null, userId = null }) {
  const daemon = await ensureLocalDaemon();
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = net.createConnection(daemon.socketPath);
    socket.setEncoding('utf8');
    const events = [];
    let buffer = '';
    let settled = false;

    const finish = (err = null, result = null) => {
      if (settled) return;
      settled = true;
      try { socket.end(); } catch {}
      if (err) rejectPromise(err);
      else resolvePromise(result);
    };

    socket.once('connect', () => {
      socket.write(JSON.stringify({
        type: 'message',
        text,
        session_id: sessionId || `local-${Date.now()}`,
        user_id: userId || `local-agent-${Date.now()}`,
      }) + '\n');
    });

    socket.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event.type === 'ready') continue;
        events.push(event);
        if (json) {
          process.stdout.write(`${JSON.stringify(event)}\n`);
        } else {
          process.stdout.write(`${formatSocketEvent(event)}\n`);
        }
        if (event.type === 'approval_request') {
          socket.write(JSON.stringify({
            type: 'approval',
            approvalId: event.approvalId,
            approved: autoApprove,
          }) + '\n');
        }
        if (event.type === 'turn_complete') {
          finish(null, { ok: true, events, model: process.env.AEGIS_AGENT_MODEL, socketPath: daemon.socketPath });
          return;
        }
        if (event.type === 'turn_error' || event.type === 'error') {
          finish(new Error(event.errorMsg || event.message || 'daemon message failed'));
          return;
        }
      }
    });

    socket.once('error', (err) => {
      finish(err);
    });
    socket.once('close', () => {
      if (!settled) {
        finish(new Error('daemon socket closed before turn_complete'));
      }
    });
  });
}

async function sendDaemonCommand(command, { json = false } = {}) {
  const daemon = await ensureLocalDaemon();
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = net.createConnection(daemon.socketPath);
    socket.setEncoding('utf8');
    let buffer = '';
    let settled = false;

    const finish = (err = null, result = null) => {
      if (settled) return;
      settled = true;
      try { socket.end(); } catch {}
      if (err) rejectPromise(err);
      else resolvePromise(result);
    };

    socket.once('connect', () => {
      socket.write(JSON.stringify(command) + '\n');
    });

    socket.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event.type === 'ready') continue;
        if (json) process.stdout.write(`${JSON.stringify(event)}\n`);
        finish(event.type === 'error' ? new Error(event.message || 'daemon command failed') : null, event);
        return;
      }
    });

    socket.once('error', (err) => finish(err));
    socket.once('close', () => {
      if (!settled) finish(new Error('daemon socket closed before reply'));
    });
  });
}

async function runTest() {
  await bootstrapLocalMode();
  runNode(['--test', 'tests/e2e/local-surfpool-live.test.mjs'], {
    extraEnv: { AEGIS_LOCAL_SURFPOOL_MODE: '1' },
  });
}

async function runStatus(flags) {
  const result = await sendDaemonCommand({ type: 'status' }, { json: !!flags.json });
  if (!flags.json) printJson(result);
}

async function runSchedule(flags, positional) {
  await bootstrapLocalMode();
  const prompt = positional.join(' ').trim() || flags.prompt;
  if (!prompt) throw new Error('schedule requires a prompt');

  const scheduleKind = flags.at ? 'at' : flags.every ? 'every' : 'cron';
  const scheduleValue = flags.at || flags.every || flags.cron;
  if (!scheduleValue) throw new Error('schedule requires one of --cron, --every, or --at');

  const summary = await withDb(async () => {
    const { createScheduledJob } = await import('../engine/runtime/scheduled-jobs.mjs');
    const job = await createScheduledJob({
      kind: 'agent_turn',
      scheduleKind,
      scheduleValue,
      userId: flags.user || 'proof-local',
      chatId: flags.chatId || null,
      prompt,
      payload: {
        origin: 'local-mode',
        autoApprove: flags['approve-all'] === true || flags.approveAll === true,
      },
      title: flags.title || 'Local scheduled agent turn',
    });
    return job;
  });

  if (flags.json) printJson(summary);
  else {
    process.stdout.write(
      `scheduled job created\n` +
      `id: ${summary.id}\n` +
      `kind: ${summary.scheduleKind}\n` +
      `value: ${summary.scheduleValue}\n`
    );
  }
}

async function runJobs(flags) {
  await bootstrapLocalMode();
  const rows = await withDb(async () => {
    const { listScheduledJobs } = await import('../engine/runtime/scheduled-jobs.mjs');
    return listScheduledJobs({ status: flags.status, kind: flags.kind });
  });
  if (flags.json) printJson(rows);
  else printJson({ count: rows.length, rows });
}

async function runNotifications(flags) {
  await bootstrapLocalMode();
  const { readNotifications } = await import('../engine/studio/routes/notifications.mjs');
  const rows = readNotifications({
    take: Number(flags.take) || 20,
    level: flags.level ? String(flags.level) : null,
  });
  if (flags.json) printJson(rows);
  else printJson({ count: rows.length, rows });
}

async function runDaemon(flags) {
  if (flags.stop) {
    await stopLocalDaemon();
    return;
  }
  const summary = await ensureLocalDaemon(flags);
  if (flags.json) printJson(summary);
  else {
    process.stdout.write(
      `local daemon ready\n` +
      `model: ${summary.model}\n` +
      `socket: ${summary.socketPath}\n`
    );
  }
}

async function runAgent(flags, positional) {
  await bootstrapLocalMode();
  const text = positional.join(' ').trim() || flags.message || DEFAULT_AGENT_MESSAGE;
  const autoApprove = flags['approve-all'] === true || flags.approveAll === true;
  const result = await sendDaemonMessage({
    text,
    autoApprove,
    json: !!flags.json,
    sessionId: flags.session,
    userId: flags.user,
  });
  if (flags.summary) {
    printJson({
      ok: result.ok,
      model: result.model,
      socketPath: result.socketPath,
      eventTypes: result.events.map((event) => event.type),
    });
  }
}

const { command, flags, positional } = parseArgs(process.argv.slice(2));

try {
  if (command === 'bootstrap') {
    await runBootstrap(flags);
  } else if (command === 'swap') {
    await runSwap(flags);
  } else if (command === 'test') {
    await runTest();
  } else if (command === 'daemon') {
    await runDaemon(flags);
  } else if (command === 'agent' || command === 'message') {
    await runAgent(flags, positional);
  } else if (command === 'status') {
    await runStatus(flags);
  } else if (command === 'schedule') {
    await runSchedule(flags, positional);
  } else if (command === 'jobs') {
    await runJobs(flags);
  } else if (command === 'notifications') {
    await runNotifications(flags);
  } else {
    throw new Error(`Unknown local-mode command: ${command}`);
  }
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
