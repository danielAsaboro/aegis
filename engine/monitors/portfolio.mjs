/**
 * Portfolio Monitor — polls portfolio allocations and emits DRIFT_DETECTED signals.
 *
 * Compares current allocation vs target allocation from rebalance configs.
 * Emits when any token drifts beyond the configured threshold.
 */

import bus from '../core/event-bus.mjs';
import { SignalType } from '../core/types.mjs';
import { monitorLog } from '../core/logger.mjs';
import { getPortfolioAllocations } from '../utils/zerion-api.mjs';
import { getActiveRebalanceTargets } from '../store/plans.mjs';

let _interval = null;

/**
 * Start the portfolio monitor.
 * @param {string} walletAddress - Wallet to monitor
 * @param {number} pollIntervalMs - How often to poll (default: 5min)
 */
export function startPortfolioMonitor(walletAddress, pollIntervalMs = 300_000) {
  monitorLog.info({ interval: pollIntervalMs }, 'Starting portfolio monitor');

  const check = () => checkPortfolio(walletAddress);
  check();
  _interval = setInterval(check, pollIntervalMs);
  return () => stopPortfolioMonitor();
}

export function stopPortfolioMonitor() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
    monitorLog.info('Portfolio monitor stopped');
  }
}

async function checkPortfolio(walletAddress) {
  const targets = getActiveRebalanceTargets();
  if (targets.length === 0) return;

  for (const target of targets) {
    try {
      const positions = await getPortfolioAllocations(walletAddress, target.chain);
      if (positions.length === 0) continue;

      const drifts = [];
      for (const t of target.targets) {
        const current = positions.find(
          p => p.token.toUpperCase() === t.token.toUpperCase()
        );
        const actualAllocation = current?.allocation || 0;
        const delta = actualAllocation - t.weight;

        if (Math.abs(delta) >= (target.threshold || 5)) {
          drifts.push({
            token: t.token,
            target: t.weight,
            actual: Number(actualAllocation.toFixed(2)),
            delta: Number(delta.toFixed(2)),
            currentValue: current?.value || 0,
          });
        }
      }

      if (drifts.length > 0) {
        monitorLog.info({
          targetId: target.id,
          driftCount: drifts.length,
          chain: target.chain,
        }, 'Portfolio drift detected');

        bus.signal(SignalType.DRIFT_DETECTED, {
          targetId: target.id,
          chain: target.chain,
          chatId: target.chatId,
          targets: target.targets,
          positions,
          drifts,
          policies: target.policies,
        });
      }
    } catch (err) {
      monitorLog.warn({ err: err.message, targetId: target.id }, 'Portfolio check failed');
    }
  }
}

export { checkPortfolio };
