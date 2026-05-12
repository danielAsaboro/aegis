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
import { getEvmAddress, getSolAddress } from '../cli/utils/wallet/keystore.js';
import { isSolana } from '../cli/utils/chain/registry.js';
import { startSocketServer, stopSocketServer, broadcastEvent } from './ipc/socket.mjs';
import { sweepExpiredMissions, listMissions } from './missions/index.mjs';
import { notify } from './notify/index.mjs';
import { createMessageRuntime } from './runtime/message-runtime.mjs';

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
  const messageRuntime = createMessageRuntime({
    walletName,
    deliveryHandlers: {
      socket: async ({ envelope, type, text, ...rest }) => {
        const socket = envelope.delivery?.socket;
        if (!socket) return;
        const payload = type === 'response' ? { type, text } : { type, ...rest };
        try { socket.write(JSON.stringify(payload) + '\n'); } catch { /* ignore */ }
      },
      notification: async ({ type, text }) => {
        if (type !== 'response' || !text) return;
        await notify({
          level: 'info',
          title: 'Scheduled agent update',
          body: text,
        });
      },
      default: async ({ type, text }) => {
        if (type !== 'response' || !text) return;
        await notify({ level: 'info', title: 'AEGIS agent update', body: text });
      },
    },
    approvalHandlers: {
      socket: async ({ envelope, approvals }) => {
        const socket = envelope.delivery?.socket;
        if (!socket) return approvals.map(() => false);
        const decisions = [];
        for (const req of approvals) {
          try {
            socket.write(JSON.stringify({
              type: 'approval_request',
              approvalId: req.approvalId,
              toolName: req.toolName,
              args: req.args ?? null,
            }) + '\n');
          } catch {
            decisions.push(false);
            continue;
          }
          const approved = await new Promise((resolve) => {
            pendingApprovals.set(req.approvalId, resolve);
          });
          decisions.push(!!approved);
        }
        return decisions;
      },
      default: async ({ approvals }) => approvals.map(() => false),
    },
  });

  const handleMessage = async ({ text, socket, sessionId, userId: explicitUserId, chatId }) => {
    const sid = sessionId || `socket-${socket.remoteAddress || 'local'}-${Date.now()}`;
    const userId = explicitUserId || sessions.get(sid)?.userId || sid;
    sessions.set(sid, { userId });
    await messageRuntime.enqueueMessage({
      userId,
      chatId: chatId || null,
      source: 'daemon',
      prompt: text,
      delivery: { type: 'socket', socket },
      metadata: { sessionId: sid },
    });
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
    messageRuntime,
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
    try { messageRuntime.stop(); } catch { /* ignore */ }
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
