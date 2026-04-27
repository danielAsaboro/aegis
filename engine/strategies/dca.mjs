/**
 * DCA Strategy — Dollar Cost Averaging.
 *
 * On DCA_TICK signal: creates a TradeProposal to buy $X of token Y.
 * One of the simplest and most used strategies.
 */

import { BaseStrategy } from './base.mjs';
import { SignalType, createTradeProposal, StrategyType } from '../core/types.mjs';

export class DCAStrategy extends BaseStrategy {
  constructor({ walletName }) {
    super({
      id: StrategyType.DCA,
      name: 'DCA (Dollar Cost Average)',
      signals: [SignalType.DCA_TICK],
      walletName,
    });
  }

  async evaluate(signal) {
    // DCA_TICK carries everything we need from the scheduler
    const isPrivate = signal.forcePrivate || false;
    return createTradeProposal({
      strategyId: signal.planId,
      strategyType: StrategyType.DCA,
      fromToken: signal.fromToken || 'USDC',
      toToken: signal.toToken,
      amount: signal.amount,
      chain: signal.chain,
      reason: isPrivate
        ? `DCA private buy — ${signal.fromToken || 'USDC'} → ${signal.toToken}`
        : `DCA scheduled buy — ${signal.fromToken || 'USDC'} → ${signal.toToken}`,
      signal,
      policies: signal.policies || {},
      forcePrivate: isPrivate,
    });
  }
}
