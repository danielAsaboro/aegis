/**
 * Dip Buyer Strategy — buys on significant price drops.
 *
 * On PRICE_DIP signal: if drop >= configured threshold, creates a buy proposal.
 */

import { BaseStrategy } from './base.mjs';
import { SignalType, createTradeProposal, StrategyType } from '../core/types.mjs';
import { getPriceAlerts } from '../store/plans.mjs';

export class DipBuyerStrategy extends BaseStrategy {
  constructor({ walletName }) {
    super({
      id: StrategyType.DIP_BUYER,
      name: 'Dip Buyer',
      signals: [SignalType.PRICE_DIP],
      walletName,
    });
  }

  async evaluate(signal) {
    // Find the alert that triggered this
    const alerts = getPriceAlerts().filter(
      a => a.id === signal.alertId && a.type === 'dip-buyer' && a.status === 'active'
    );

    if (alerts.length === 0) return null;
    const alert = alerts[0];

    // Only buy if we have buy configuration
    if (!alert.buyToken || !alert.buyAmount) return null;

    return createTradeProposal({
      strategyId: `dip-${alert.id}`,
      strategyType: StrategyType.DIP_BUYER,
      fromToken: alert.buyToken, // usually USDC
      toToken: signal.token,
      amount: alert.buyAmount,
      chain: signal.chain,
      reason: `Price dip ${signal.dropPercent.toFixed(1)}% detected — auto-buying ${signal.token}`,
      signal,
      policies: alert.policies || {},
    });
  }
}
