/**
 * Consensus policy — requires N/M Telegram votes for trades.
 * Used by group-consensus strategy.
 *
 * Follows Zerion's policy contract: check(ctx) → { allow, reason }
 */

import { getProposal } from '../store/plans.mjs';

export async function check(ctx) {
  const config = ctx.policy_config || {};
  const proposal = ctx.proposal || {};

  // Only applies to group trades
  if (proposal.strategyType !== 'group') {
    return { allow: true };
  }

  const proposalId = proposal.signal?.proposalId;
  if (!proposalId) {
    return { allow: false, reason: 'No proposal ID found for group trade' };
  }

  const groupProposal = await getProposal(proposalId);
  if (!groupProposal) {
    return { allow: false, reason: `Proposal ${proposalId} not found` };
  }

  // Check expiry
  if (new Date(groupProposal.expiresAt) < new Date()) {
    return { allow: false, reason: `Proposal ${proposalId} has expired` };
  }

  // Count approvals
  const approvals = Object.values(groupProposal.votes).filter(v => v === 'approve').length;
  const required = config.requiredVotes || groupProposal.requiredVotes || 3;

  if (approvals < required) {
    return {
      allow: false,
      reason: `Need ${required} approvals, only have ${approvals}`,
    };
  }

  return { allow: true };
}
