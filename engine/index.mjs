#!/usr/bin/env node
/**
 * AEGIS — Autonomous Execution Governed by Intelligence Signals
 *
 * Entry point. Boots:
 * 1. Config validation
 * 2. Store initialization
 * 3. Telegram bot
 * 4. Signal monitors
 * 5. Trading strategies
 *
 * Everything connects through the event bus:
 *   Monitors → Event Bus → Strategies → Policy Engine → Execution Engine
 */

import env from './config.mjs';
import logger from './core/logger.mjs';
import { initPlansStore } from './store/plans.mjs';
import { initExecutionsStore } from './store/executions.mjs';
import { initStateStore } from './store/state.mjs';
import { initShieldStore } from './store/shield.mjs';
import { createBot, setupNotifications } from './bot/index.mjs';
import { startAllMonitors, stopAllMonitors } from './monitors/index.mjs';
import { startAllStrategies, stopAllStrategies } from './strategies/index.mjs';
import { getEvmAddress, getSolAddress } from '../cli/lib/wallet/keystore.js';
import { isSolana } from '../cli/lib/chain/registry.js';

async function main() {
  logger.info('═══════════════════════════════════════════════');
  logger.info('  AEGIS — Autonomous Execution Governed by Intelligence Signals');
  logger.info('  Privacy-first autonomous trading agent');
  logger.info('  Powered by Zerion + MagicBlock');
  logger.info('═══════════════════════════════════════════════');

  // ─── 1. Initialize stores ──────────────────────────────────────────────
  const dataDir = env.DATA_DIR;
  logger.info({ dataDir }, 'Initializing stores');
  initPlansStore(dataDir);
  initExecutionsStore(dataDir);
  initStateStore(dataDir);
  initShieldStore(dataDir); // MagicBlock shielded balance tracking

  // ─── 2. Resolve wallet ────────────────────────────────────────────────
  const walletName = env.DEFAULT_WALLET || 'default';
  let walletAddress;
  try {
    walletAddress = isSolana(env.DEFAULT_CHAIN)
      ? getSolAddress(walletName)
      : getEvmAddress(walletName);
    logger.info({ wallet: walletName, address: walletAddress, chain: env.DEFAULT_CHAIN }, 'Wallet resolved');
  } catch (err) {
    logger.warn({ err: err.message }, 'Wallet resolution failed — bot will start but trading needs a wallet');
    walletAddress = null;
  }

  // Note: MagicBlock private execution requires keypair access
  // For full privacy support, extend wallet keystore or pass keypair via env

  // ─── 3. Start Telegram bot ────────────────────────────────────────────
  const botConfig = {
    botToken: env.TELEGRAM_BOT_TOKEN,
    walletName,
    defaultChain: env.DEFAULT_CHAIN,
    requiredVotes: 3,
    // keypair: null — MagicBlock private execution requires keypair setup
  };

  const bot = createBot(botConfig);
  const notifyFn = setupNotifications(bot);

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
  await bot.launch();
  logger.info('Telegram bot launched — AEGIS is live');

  // ─── Graceful shutdown ────────────────────────────────────────────────
  const shutdown = (signal) => {
    logger.info({ signal }, 'Shutting down...');
    stopAllMonitors();
    stopAllStrategies();
    bot.stop(signal);
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
