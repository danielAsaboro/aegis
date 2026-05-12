/**
 * Monitor registry — starts and stops all signal monitors.
 */

import { startPriceMonitor, stopPriceMonitor } from './price.mjs';
import { startPortfolioMonitor, stopPortfolioMonitor } from './portfolio.mjs';
import { startScheduler, stopScheduler, syncJobs } from './scheduler.mjs';
import { startWhaleMonitor, stopWhaleMonitor } from './whale.mjs';
import { monitorLog } from '../core/logger.mjs';

const _stopFns = [];

/**
 * Start all monitors.
 * @param {object} config
 * @param {string} config.walletAddress - Wallet address to monitor
 * @param {number} config.priceInterval - Price poll interval (ms)
 * @param {number} config.portfolioInterval - Portfolio poll interval (ms)
 * @param {number} config.whaleInterval - Whale poll interval (ms)
 */
export function startAllMonitors(config) {
  monitorLog.info('Starting all monitors');

  _stopFns.push(startScheduler({ messageRuntime: config.messageRuntime }));
  _stopFns.push(startPriceMonitor(config.priceInterval));

  if (config.walletAddress) {
    _stopFns.push(startPortfolioMonitor(config.walletAddress, config.portfolioInterval));
  }

  _stopFns.push(startWhaleMonitor(config.whaleInterval));

  monitorLog.info('All monitors started');
}

/**
 * Stop all monitors gracefully.
 */
export function stopAllMonitors() {
  monitorLog.info('Stopping all monitors');
  for (const stop of _stopFns) {
    try { stop(); } catch { /* ignore */ }
  }
  _stopFns.length = 0;
}

export async function syncMonitorJobs(opts = {}) {
  return syncJobs({ messageRuntime: opts.messageRuntime });
}

export { syncJobs };
