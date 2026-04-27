/**
 * Rebalancer Strategy — restores target portfolio allocations on drift.
 *
 * On DRIFT_DETECTED signal: calculates which swaps are needed to restore
 * target weights, then proposes trades for each overweight → underweight pair.
 */

import { BaseStrategy } from './base.mjs';
import { SignalType, createTradeProposal, StrategyType } from '../core/types.mjs';
import { strategyLog } from '../core/logger.mjs';

export class RebalancerStrategy extends BaseStrategy {
  constructor({ walletName }) {
    super({
      id: StrategyType.REBALANCER,
      name: 'Portfolio Rebalancer',
      signals: [SignalType.DRIFT_DETECTED],
      walletName,
    });
  }

  /**
   * Evaluate drift signal — returns a single trade proposal for the largest imbalance.
   * For simplicity, we handle one rebalance trade at a time (sell overweight, buy underweight).
   */
  async evaluate(signal) {
    const { drifts, chain, policies } = signal;

    if (!drifts || drifts.length === 0) return null;

    // Find the most overweight and most underweight tokens
    const overweight = drifts.filter(d => d.delta > 0).sort((a, b) => b.delta - a.delta);
    const underweight = drifts.filter(d => d.delta < 0).sort((a, b) => a.delta - b.delta);

    if (overweight.length === 0 || underweight.length === 0) return null;

    const sellToken = overweight[0];
    const buyToken = underweight[0];

    // Calculate amount to sell (rough: sell proportional to excess allocation)
    // Use the smaller of the two deltas to avoid over-correcting
    const rebalancePercent = Math.min(Math.abs(sellToken.delta), Math.abs(buyToken.delta));
    const sellValue = (sellToken.currentValue * rebalancePercent) / sellToken.actual;

    // Don't rebalance for tiny amounts
    if (sellValue < 1) return null;

    const amount = sellValue.toFixed(2);

    strategyLog.info({
      sell: sellToken.token,
      buy: buyToken.token,
      amount,
      sellDelta: sellToken.delta,
      buyDelta: buyToken.delta,
    }, 'Rebalance trade calculated');

    return createTradeProposal({
      strategyId: `rebal-${signal.targetId}`,
      strategyType: StrategyType.REBALANCER,
      fromToken: sellToken.token,
      toToken: buyToken.token,
      amount,
      chain,
      reason: `Portfolio drift: ${sellToken.token} +${sellToken.delta.toFixed(1)}%, ${buyToken.token} ${buyToken.delta.toFixed(1)}%`,
      signal,
      policies: policies || {},
    });
  }
}
