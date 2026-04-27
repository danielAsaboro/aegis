/**
 * Strategy registry — creates and manages all AEGIS strategies.
 */

import { DCAStrategy } from './dca.mjs';
import { DipBuyerStrategy } from './dip-buyer.mjs';
import { TakeProfitStrategy } from './take-profit.mjs';
import { RebalancerStrategy } from './rebalancer.mjs';
import { GroupConsensusStrategy } from './group-consensus.mjs';
import { strategyLog } from '../core/logger.mjs';

const _strategies = new Map();

/**
 * Initialize and start all strategies.
 * @param {object} config
 * @param {string} config.walletName - OWS wallet name
 * @param {Function} [config.notifyFn] - Telegram notification callback
 */
export function startAllStrategies(config) {
  const { walletName, notifyFn } = config;

  const strategies = [
    new DCAStrategy({ walletName }),
    new DipBuyerStrategy({ walletName }),
    new TakeProfitStrategy({ walletName }),
    new RebalancerStrategy({ walletName }),
    new GroupConsensusStrategy({ walletName }),
  ];

  for (const strategy of strategies) {
    if (notifyFn) strategy.onNotify(notifyFn);
    strategy.start();
    _strategies.set(strategy.id, strategy);
  }

  strategyLog.info({ count: strategies.length }, 'All strategies started');
}

/**
 * Stop all strategies.
 */
export function stopAllStrategies() {
  for (const strategy of _strategies.values()) {
    strategy.stop();
  }
  _strategies.clear();
  strategyLog.info('All strategies stopped');
}

/**
 * Get a strategy by ID.
 */
export function getStrategy(id) {
  return _strategies.get(id) || null;
}

/**
 * Get all active strategies.
 */
export function getAllStrategies() {
  return Array.from(_strategies.values());
}
