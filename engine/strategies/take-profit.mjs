/**
 * Take Profit Strategy — sells on significant price gains.
 *
 * On PRICE_SPIKE signal: if gain >= configured threshold, creates a sell proposal.
 */

import { BaseStrategy } from './base.mjs';
import { SignalType, createTradeProposal, StrategyType } from '../core/types.mjs';
import { getPriceAlerts } from '../store/plans.mjs';

export class TakeProfitStrategy extends BaseStrategy {
  constructor({ walletName }) {
    super({
      id: StrategyType.TAKE_PROFIT,
      name: 'Take Profit',
      signals: [SignalType.PRICE_SPIKE],
      walletName,
    });
  }

  async evaluate(signal) {
    const alerts = getPriceAlerts().filter(
      a => a.id === signal.alertId && a.type === 'take-profit' && a.status === 'active'
    );

    if (alerts.length === 0) return null;
    const alert = alerts[0];

    if (!alert.buyAmount) return null;

    return createTradeProposal({
      strategyId: `tp-${alert.id}`,
      strategyType: StrategyType.TAKE_PROFIT,
      fromToken: signal.token, // sell the token that spiked
      toToken: alert.buyToken || 'USDC', // take profit into stablecoin
      amount: alert.buyAmount,
      chain: signal.chain,
      reason: `Price spike +${signal.gainPercent.toFixed(1)}% detected — taking profit on ${signal.token}`,
      signal,
      policies: alert.policies || {},
    });
  }
}
