#!/usr/bin/env node
/**
 * AEGIS — Autonomous Execution Governed by Intelligence Signals
 *
 * Entry point. Sub-routes:
 *   - `aegis chat ...`  → CLI chat REPL (no bot/monitors)
 *   - default           → Boot bot + strategies + monitors
 */

// Sub-route `aegis mcp` — STDIO MCP server exposing the AEGIS tool catalog
// to MCP clients (Codex CLI, Claude Code, Cursor, ...). No bot env vars needed.
if (process.argv[2] === 'mcp') {
  const { default: mcpCmd } = await import('../cli/commands/mcp.js');
  await mcpCmd(process.argv.slice(3));
  process.exit(0);
}

// Sub-route `aegis judge-trace` — single-screen policy + privacy state
// machine. Read-only, no network, no money moved. Designed for evaluators.
if (process.argv[2] === 'judge-trace') {
  await import('../scripts/judge-trace.mjs');
  // judge-trace.mjs runs main() at import time and exits on completion.
  process.exit(0);
}

// Sub-route `aegis demo` — end-to-end pipeline walk-through. Mirrors
// `pnpm demo`. Pass `--execute` to broadcast real MagicBlock transactions.
if (process.argv[2] === 'demo') {
  process.argv.splice(2, 1); // strip 'demo' so scripts/demo.mjs sees the rest
  await import('../scripts/demo.mjs');
  process.exit(0);
}

// Sub-route `aegis daemon-supervisor` — internal entry the user-facing
// `aegis daemon start` spawns. Boots monitors + strategies + IPC socket
// + mission executor; survives until SIGTERM/SIGINT.
if (process.argv[2] === 'daemon-supervisor') {
  const { runDaemonSupervisor } = await import('./daemon-supervisor.mjs');
  await runDaemonSupervisor();
  // runDaemonSupervisor never returns — process stays up until signaled.
}

// No args → launch the chat TUI directly, same as `aegis chat`
if (process.argv.length === 2) {
  process.argv.splice(2, 0, 'chat');
}

// Sub-route `aegis chat` BEFORE static config import so chat works even
// when the bot-only env vars (TELEGRAM_BOT_TOKEN) aren't configured.
if (process.argv[2] === 'chat') {
  // Route logs to stderr so they don't pollute the chat conversation on stdout.
  process.env.AEGIS_LOG_STDERR = '1';
  const rest = process.argv.slice(3);
  const { default: chatCmd } = await import('../cli/commands/chat.js');
  const { parseFlags } = await import('../cli/utils/common/flags.js');
  const { rest: positional, flags } = parseFlags(rest);
  await chatCmd(positional, flags);
  process.exit(0);
}

// Parse --studio / --studio-port BEFORE the logger is imported, since
// the logger reads STUDIO_ENABLED at construction time to decide whether
// to fork log lines into the studio's WS bridge.
const _studioFlag = process.argv.includes('--studio');
const _studioPortIdx = process.argv.indexOf('--studio-port');
const _studioPort = _studioPortIdx >= 0 ? Number(process.argv[_studioPortIdx + 1]) : 7474;
if (_studioFlag) process.env.STUDIO_ENABLED = '1';

const { default: env } = await import('./config.mjs');
const { default: logger } = await import('./core/logger.mjs');
const { initDb } = await import('./db/index.mjs');
const { createBot, setupNotifications } = await import('./bot/index.mjs');
const { startAllMonitors, stopAllMonitors } = await import('./monitors/index.mjs');
const { startAllStrategies, stopAllStrategies } = await import('./strategies/index.mjs');
const { getEvmAddress, getSolAddress, importFromKey, createWallet } = await import('../cli/utils/wallet/keystore.js');
const { isSolana } = await import('../cli/utils/chain/registry.js');

async function main() {
  logger.info('═══════════════════════════════════════════════');
  logger.info('  AEGIS — Autonomous Execution Governed by Intelligence Signals');
  logger.info('  Privacy-first autonomous trading agent');
  logger.info('  Powered by Zerion + MagicBlock');
  logger.info('═══════════════════════════════════════════════');

  if (!env.TELEGRAM_BOT_TOKEN && !_studioFlag) {
    logger.fatal('TELEGRAM_BOT_TOKEN is required to launch the bot. Set it in .env, run `aegis --studio` to boot studio without the bot, or `aegis chat` for the CLI surface.');
    process.exit(1);
  }
  if (!env.ZERION_API_KEY) {
    logger.fatal('ZERION_API_KEY is required for portfolio/trade tools. Set it in .env (get one at dashboard.zerion.io).');
    process.exit(1);
  }

  // ─── 1. Initialize database ───────────────────────────────────────────
  logger.info({ dataDir: env.DATA_DIR }, 'Initializing Prisma store');
  await initDb();

  // ─── 1b. Optional QVAC backfill ───────────────────────────────────────
  if (env.QVAC_BACKFILL && env.QVAC_ENABLE_RAG) {
    try {
      const { backfillAll } = await import('./qvac/indexer.mjs');
      const stats = await backfillAll();
      logger.info(stats, 'QVAC backfill complete');
    } catch (err) {
      logger.warn({ err: err.message }, 'QVAC backfill failed (non-fatal)');
    }
  }

  // ─── 2. Resolve wallet — auto-provision if missing ───────────────────
  const walletName = env.DEFAULT_WALLET || 'main';
  let walletAddress;
  try {
    walletAddress = isSolana(env.DEFAULT_CHAIN)
      ? getSolAddress(walletName)
      : getEvmAddress(walletName);
    logger.info({ wallet: walletName, address: walletAddress, chain: env.DEFAULT_CHAIN }, 'Wallet resolved');
  } catch {
    // Wallet doesn't exist — provision it now, no human needed.
    logger.info({ wallet: walletName }, 'Wallet not found — auto-provisioning');
    try {
      let provisioned;
      if (process.env.SOLANA_PRIVATE_KEY) {
        // Import the same key already used for MagicBlock so both surfaces
        // share one address. Empty passphrase = unencrypted at rest; security
        // comes from filesystem permissions on the OWS keystore.
        provisioned = importFromKey(walletName, process.env.SOLANA_PRIVATE_KEY, '', 'solana');
        logger.info({ wallet: walletName, address: provisioned.solAddress }, 'Wallet imported from SOLANA_PRIVATE_KEY');
      } else {
        // No existing key — generate a fresh Solana wallet and log the address
        // so the operator can fund it.
        provisioned = createWallet(walletName, '');
        logger.info({ wallet: walletName, address: provisioned.solAddress }, 'Fresh wallet generated — fund this address to enable trading');
      }
      walletAddress = provisioned.solAddress;
    } catch (provisionErr) {
      logger.warn({ err: provisionErr.message }, 'Wallet provisioning failed — bot will start but trading needs a wallet');
      walletAddress = null;
    }
  }

  // Note: MagicBlock private execution requires keypair access
  // For full privacy support, extend wallet keystore or pass keypair via env

  // ─── 3. Start Telegram bot (optional in studio-only mode) ────────────
  let bot = null;
  let notifyFn = null;
  if (env.TELEGRAM_BOT_TOKEN) {
    const botConfig = {
      botToken: env.TELEGRAM_BOT_TOKEN,
      walletName,
      defaultChain: env.DEFAULT_CHAIN,
      requiredVotes: 3,
    };
    bot = createBot(botConfig);
    notifyFn = setupNotifications(bot);
  } else {
    logger.info('No TELEGRAM_BOT_TOKEN — running studio-only (engine subsystems active, no bot)');
  }

  // ─── 4. Start strategies ──────────────────────────────────────────────
  startAllStrategies({
    walletName,
    notifyFn,
  });

  // ─── 5. Start monitors ───────────────────────────────────────────────
  startAllMonitors({
    walletAddress,
    priceInterval: env.PRICE_POLL_INTERVAL,
    portfolioInterval: env.PORTFOLIO_POLL_INTERVAL,
    whaleInterval: env.WHALE_POLL_INTERVAL,
  });

  // ─── 6. Launch bot ────────────────────────────────────────────────────
  // Telegraf 4's `bot.launch()` returns a promise that only resolves on
  // shutdown — awaiting it blocks the rest of main() forever, so the
  // studio HTTP server below would never bind. Fire-and-forget; surface
  // launch errors through .catch so they aren't swallowed.
  if (bot) {
    bot.launch()
      .then(() => logger.info('Telegram bot terminated'))
      .catch((err) => logger.error({ err: err.message }, 'Telegram bot launch failed'));
    logger.info('Telegram bot launching — AEGIS is live');
  }

  // ─── 7. Optional studio server ───────────────────────────────────────
  let studio = null;
  if (_studioFlag) {
    const { startStudio } = await import('./studio/server.mjs');
    studio = await startStudio({ port: _studioPort });
  }

  // ─── Graceful shutdown ────────────────────────────────────────────────
  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutting down...');
    if (studio) {
      try { await studio.stop(); } catch { /* ignore */ }
    }
    stopAllMonitors();
    stopAllStrategies();
    if (bot) bot.stop(signal);
    try {
      const { shutdownSidecar } = await import('./qvac/sidecar/client.mjs');
      await shutdownSidecar();
    } catch (err) {
      logger.warn({ err: err.message }, 'sidecar shutdown failed');
    }
    logger.info('AEGIS stopped gracefully');
    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err: err.message, stack: err.stack }, 'Fatal error');
  process.exit(1);
});
