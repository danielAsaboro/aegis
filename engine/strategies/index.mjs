/**
 * Strategy registry — creates and manages all AEGIS strategies.
 */

import { DCAStrategy } from './dca.mjs';
import { DipBuyerStrategy } from './dip-buyer.mjs';
import { TakeProfitStrategy } from './take-profit.mjs';
import { RebalancerStrategy } from './rebalancer.mjs';
import { GroupConsensusStrategy } from './group-consensus.mjs';
import { AgentStrategy } from './agent.mjs';
import { strategyLog } from '../core/logger.mjs';
import env from '../config.mjs';

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

  // The LLM agent strategy only attaches when autonomy != 'off' AND at
  // least one model backend is reachable. Backends are subscription-only
  // or local: codex (Codex CLI on PATH or CODEX_BIN) and qvac (a real
  // QVAC_LLM_MODEL_PATH on disk). Without one of these, AgentStrategy
  // would loop waiting on a model it can never load.
  const hasCodex = env.AEGIS_AGENT_MODEL.startsWith('codex/');
  const hasQvac = env.AEGIS_AGENT_MODEL.startsWith('qvac/') && !!env.QVAC_LLM_MODEL_PATH;
  if (env.AEGIS_AGENT_AUTONOMY !== 'off' && (hasCodex || hasQvac)) {
    strategies.push(new AgentStrategy({ walletName }));
  } else if (env.AEGIS_AGENT_AUTONOMY !== 'off') {
    strategyLog.warn(
      `AEGIS_AGENT_AUTONOMY=${env.AEGIS_AGENT_AUTONOMY} but no usable backend ` +
      `(AEGIS_AGENT_MODEL=${env.AEGIS_AGENT_MODEL}, QVAC_LLM_MODEL_PATH=${env.QVAC_LLM_MODEL_PATH ? 'set' : 'unset'}) — AgentStrategy not attached`
    );
  }

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
