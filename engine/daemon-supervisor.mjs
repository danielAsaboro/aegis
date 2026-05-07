/**
 * Daemon supervisor — long-lived process that owns the IPC socket,
 * scheduler, monitors, strategies, mission executor, and a chat session
 * surface for attached clients.
 *
 * Spawned by `commands/daemon.js` via the AEGIS_DAEMON=1 env flag.
 * Survives until SIGTERM/SIGINT.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import env from './config.mjs';
import logger from './core/logger.mjs';
import { initDb, closeDb } from './db/index.mjs';
import { startAllStrategies, stopAllStrategies } from './strategies/index.mjs';
import { startAllMonitors, stopAllMonitors } from './monitors/index.mjs';
import { getEvmAddress, getSolAddress } from '../utils/wallet/keystore.js';
import { isSolana } from '../utils/chain/registry.js';
import { startSocketServer, stopSocketServer, broadcastEvent } from './ipc/socket.mjs';
import { sweepExpiredMissions, listMissions } from './missions/index.mjs';
import { notify } from './notify/index.mjs';

const SWEEP_INTERVAL_MS = 60_000;

export async function runDaemonSupervisor() {
  const dataDir = env.DATA_DIR || join(homedir(), '.zerion', 'aegis');
  const sockPath = process.env.AEGIS_DAEMON_SOCK || join(dataDir, 'daemon.sock');
  const pidPath = process.env.AEGIS_DAEMON_PID_PATH || join(dataDir, 'daemon.pid');

  logger.info('═══════════════════════════════════════════════');
  logger.info('  AEGIS daemon — autonomous agent supervisor');
  logger.info('═══════════════════════════════════════════════');
  logger.info({ sockPath, pidPath, pid: process.pid }, 'daemon starting');

  writeFileSync(pidPath, `${process.pid}\n`, 'utf8');

  // 1. DB
  await initDb();

  // 2. Wallet resolution (best effort — daemon stays up even when
  //    wallets aren't configured yet so the user can attach a TUI to
  //    fix it).
  const walletName = env.DEFAULT_WALLET || 'default';
  let walletAddress = null;
  try {
    walletAddress = isSolana(env.DEFAULT_CHAIN)
      ? getSolAddress(walletName)
      : getEvmAddress(walletName);
  } catch (err) {
    logger.warn({ err: err.message }, 'wallet resolution failed (daemon stays up)');
  }

  // 3. IPC socket — owns chat sessions for attached TUIs.
  const sessions = new Map(); // sessionId → state
  const pendingApprovals = new Map(); // approvalId → resolve(boolean)

  const handleMessage = async ({ text, socket, sessionId }) => {
    const sid = sessionId || `socket-${socket.remoteAddress || 'local'}-${Date.now()}`;
    const userId = sessions.get(sid)?.userId || sid;
    const { runAgentTurn, appendHistory } = await import('./agent/index.mjs');

    const writeLine = (obj) => {
      try { socket.write(JSON.stringify(obj) + '\n'); } catch { /* ignore */ }
    };

    let messages;
    while (true) {
      const result = await runAgentTurn({
        userId,
        source: 'daemon',
        walletName,
        prompt: messages ? undefined : text,
        messages,
        onEvents: (events) => {
          events.on('tool-call-start', ({ toolName, input }) => {
            writeLine({ type: 'tool_start', toolName, input: input ?? null });
          });
          events.on('tool-call-finish', ({ toolName, success, durationMs, output }) => {
            let resultPreview = null;
            if (success && output != null) {
              try {
                const s = typeof output === 'string' ? output : JSON.stringify(output);
                if (s && s.length <= 200) resultPreview = s;
              } catch { /* ignore */ }
            }
            writeLine({ type: 'tool_finish', toolName, success: !!success, durationMs: durationMs ?? null, resultPreview });
          });
          events.on('tool-error', ({ toolName, errorMsg }) => {
            writeLine({ type: 'tool_error', toolName, errorMsg: errorMsg ?? '' });
          });
        },
      });
      messages = undefined;

      if (result.text) writeLine({ type: 'response', text: result.text });

      // Pending approvals — emit to client and wait for ack.
      const pending = collectPendingApprovals(result.response?.messages);
      if (pending.length === 0) break;
      const responses = [];
      for (const req of pending) {
        writeLine({
          type: 'approval_request',
          approvalId: req.approvalId,
          toolName: req.toolName,
          args: req.args ?? null,
        });
        const approved = await new Promise((resolve) => {
          pendingApprovals.set(req.approvalId, resolve);
        });
        responses.push({
          type: 'tool-approval-response',
          approvalId: req.approvalId,
          approved,
        });
      }
      const toolMsg = { role: 'tool', content: responses };
      await appendHistory(userId, [toolMsg]);
    }
  };

  await startSocketServer({
    sockPath,
    state: {
      model: env.AEGIS_AGENT_MODEL,
      wallet: walletAddress,
      startedAt: new Date().toISOString(),
    },
    onMessage: handleMessage,
    onApproval: ({ approvalId, approved }) => {
      const resolve = pendingApprovals.get(approvalId);
      if (resolve) {
        pendingApprovals.delete(approvalId);
        resolve(!!approved);
      }
    },
  });

  // 4. Strategies — emit notifyFn-bridged events that translate to socket
  //    broadcasts (existing TUIs already render these).
  const notifyFn = ({ type, proposal, deniedBy, reason, result, explorerUrl }) => {
    broadcastEvent({
      type: type === 'denied' ? 'strategy_denied' : type === 'failed' ? 'strategy_failed' : 'strategy_executed',
      strategyId: proposal?.strategyId || null,
      proposalId: proposal?.id || null,
      missionId: proposal?.missionId || null,
      deniedBy: deniedBy || null,
      reason: reason || null,
      txHash: result?.txHash || null,
      explorerUrl: explorerUrl || null,
    });
  };
  startAllStrategies({ walletName, notifyFn });

  // 5. Monitors — scheduler + price + portfolio + whale.
  startAllMonitors({
    walletAddress,
    priceInterval: env.PRICE_POLL_INTERVAL,
    portfolioInterval: env.PORTFOLIO_POLL_INTERVAL,
    whaleInterval: env.WHALE_POLL_INTERVAL,
  });

  // 6. Mission executor — sweep expired/budget-exhausted missions.
  const sweep = setInterval(() => {
    sweepExpiredMissions().catch((err) => {
      logger.warn({ err: err.message }, 'mission sweep failed');
    });
  }, SWEEP_INTERVAL_MS);

  // Startup notification
  try {
    const active = await listMissions({ status: 'active' });
    await notify({
      level: 'info',
      title: 'Aegis daemon online',
      body: `${active.length} active mission${active.length === 1 ? '' : 's'}; socket ${sockPath}`,
    });
  } catch { /* non-fatal */ }

  logger.info('daemon ready — strategies + monitors + IPC up');

  // 7. Graceful shutdown
  const shutdown = async (signal) => {
    logger.info({ signal }, 'daemon shutting down');
    try { clearInterval(sweep); } catch { /* ignore */ }
    try { stopAllMonitors(); } catch { /* ignore */ }
    try { stopAllStrategies(); } catch { /* ignore */ }
    try { await stopSocketServer(); } catch { /* ignore */ }
    try { await closeDb(); } catch { /* ignore */ }
    if (existsSync(pidPath)) {
      try { unlinkSync(pidPath); } catch { /* ignore */ }
    }
    if (existsSync(sockPath)) {
      try { unlinkSync(sockPath); } catch { /* ignore */ }
    }
    try {
      await notify({ level: 'info', title: 'Aegis daemon stopped', body: `signal=${signal}` });
    } catch { /* ignore */ }
    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err: err.message, stack: err.stack }, 'uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason: String(reason) }, 'unhandledRejection');
  });

  // Keep alive — interval already does that, but guard with a simple
  // never-resolving promise so the supervisor never returns to its
  // caller.
  await new Promise(() => { /* never resolves */ });
}

function collectPendingApprovals(messages) {
  const requests = [];
  const callsById = new Map();
  for (const msg of messages || []) {
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part.type === 'tool-call') {
        callsById.set(part.toolCallId, { name: part.toolName, args: part.input ?? part.args });
      } else if (part.type === 'tool-approval-request') {
        const call = callsById.get(part.toolCallId) || {};
        requests.push({
          approvalId: part.approvalId,
          toolCallId: part.toolCallId,
          toolName: call.name || 'tool',
          args: call.args,
        });
      }
    }
  }
  return requests;
}
