/**
 * Group Consensus Strategy — executes trades that achieve group approval.
 *
 * On CONSENSUS signal: creates a TradeProposal for the approved group trade.
 * The consensus policy (in policy engine) verifies vote counts.
 */

import { BaseStrategy } from './base.mjs';
import { SignalType, createTradeProposal, StrategyType } from '../core/types.mjs';
import { getProposal } from '../store/plans.mjs';

export class GroupConsensusStrategy extends BaseStrategy {
  constructor({ walletName }) {
    super({
      id: StrategyType.GROUP_CONSENSUS,
      name: 'Group Consensus',
      signals: [SignalType.CONSENSUS],
      walletName,
    });
  }

  async evaluate(signal) {
    const { proposalId } = signal;
    const proposal = getProposal(proposalId);

    if (!proposal || proposal.status !== 'voting') return null;

    return createTradeProposal({
      strategyId: `group-${proposalId}`,
      strategyType: StrategyType.GROUP_CONSENSUS,
      fromToken: proposal.fromToken,
      toToken: proposal.toToken,
      amount: proposal.amount,
      chain: proposal.chain,
      reason: `Group consensus reached — ${Object.values(proposal.votes).filter(v => v === 'approve').length} approvals`,
      signal: { ...signal, proposalId },
      policies: {
        'consensus': { requiredVotes: proposal.requiredVotes },
        'spend-limit': { perTick: 100, daily: 500 },
      },
    });
  }
}
