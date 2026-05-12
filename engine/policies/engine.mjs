/**
 * AEGIS Policy Engine — runs all active policies against a trade proposal.
 * AND semantics: every policy must pass for the trade to be approved.
 *
 * Composes our new policies (spend-limit, time-window, price-guard, cooldown)
 * with Zerion's existing policy contract: check(ctx) → { allow, reason }
 */

import { policyLog } from '../core/logger.mjs';
import { createPolicyResult } from '../core/types.mjs';

// Import CLI policies (each exports check(ctx))
import { check as checkSpendLimit } from '../../cli/policies/spend-limit.mjs';
import { check as checkTimeWindow } from '../../cli/policies/time-window.mjs';
import { check as checkPriceGuard } from '../../cli/policies/price-guard.mjs';
import { check as checkCooldown } from '../../cli/policies/cooldown.mjs';

// Import AEGIS consensus policy
import { check as checkConsensus } from './consensus.mjs';

// Import AEGIS privacy policy
import { check as checkPrivacy } from './privacy.mjs';

/**
 * All available policies with their check functions.
 * Each follows the Zerion contract: check(ctx) → { allow: boolean, reason?: string }
 * Privacy policy also returns usePrivate: boolean for routing decisions.
 */
const POLICIES = {
  'spend-limit': checkSpendLimit,
  'time-window': checkTimeWindow,
  'price-guard': checkPriceGuard,
  'cooldown': checkCooldown,
  'consensus': checkConsensus,
  'privacy': checkPrivacy,
};

/**
 * Error thrown when a trade is run through the policy engine without any
 * configured policies. AEGIS treats "no policies = god-mode", which is
 * exactly what the policy layer exists to prevent.
 */
export class MissingPolicyConfigError extends Error {
  constructor(proposalId) {
    super(
      `runPolicies called with empty policyConfig for proposal ${proposalId}. ` +
      `AEGIS does not support unscoped trades — attach at least one policy ` +
      `(e.g. getDefaultPolicies('manual'))`
    );
    this.code = 'missing_policy_config';
  }
}

/**
 * Run all applicable policies against a trade proposal.
 *
 * @param {object} proposal - TradeProposal
 * @param {object} policyConfig - Per-strategy policy configuration
 *   e.g. { 'spend-limit': { daily: 50, perTick: 10 }, 'cooldown': { intervalMs: 60000 } }
 * @returns {{ approved: boolean, results: Array<{ policy: string, allow: boolean, reason?: string }> }}
 */
export async function runPolicies(proposal, policyConfig = {}) {
  const results = [];
  const activePolicies = Object.keys(policyConfig).filter(k => POLICIES[k]);

  if (activePolicies.length === 0) {
    policyLog.error({ proposalId: proposal.id }, 'Refused: no policies configured');
    throw new MissingPolicyConfigError(proposal.id);
  }

  // Build policy context matching Zerion's contract
  const ctx = {
    transaction: {
      from: proposal.fromToken,
      to: proposal.toToken,
      amount: proposal.amount,
      chain: proposal.chain,
    },
    policy_config: {},
    proposal, // full proposal for AEGIS-specific policies
  };

  for (const policyName of activePolicies) {
    const checkFn = POLICIES[policyName];
    const config = policyConfig[policyName];

    // Merge policy-specific config into context
    ctx.policy_config = { ...config, strategyId: proposal.strategyId };

    try {
      const result = await Promise.resolve(checkFn(ctx));
      results.push({ policy: policyName, ...result });

      if (!result.allow) {
        policyLog.info({
          proposalId: proposal.id,
          policy: policyName,
          reason: result.reason,
        }, 'Trade denied by policy');

        return {
          approved: false,
          deniedBy: policyName,
          reason: result.reason,
          results,
        };
      }

      policyLog.debug({ proposalId: proposal.id, policy: policyName }, 'Policy passed');
    } catch (err) {
      policyLog.error({ proposalId: proposal.id, policy: policyName, err: err.message }, 'Policy check failed');
      results.push({
        policy: policyName,
        allow: false,
        reason: `Policy error: ${err.message}`,
      });
      return {
        approved: false,
        deniedBy: policyName,
        reason: `Policy error: ${err.message}`,
        results,
      };
    }
  }

  // Check if any policy (especially 'privacy') indicates private execution
  const privacyResult = results.find(r => r.policy === 'privacy');
  const usePrivate = privacyResult?.usePrivate || false;

  policyLog.info({ proposalId: proposal.id, policies: activePolicies.length, usePrivate }, 'All policies passed');
  return { approved: true, results, usePrivate };
}

/**
 * Get list of all available policies with descriptions.
 */
export function listAvailablePolicies() {
  return [
    { id: 'spend-limit', name: 'Spend Limit', desc: 'Per-tick, daily, and total USD caps per strategy' },
    { id: 'time-window', name: 'Time Window', desc: 'Restrict trades to configured hours (UTC)' },
    { id: 'price-guard', name: 'Price Guard', desc: 'Max slippage and price bounds' },
    { id: 'cooldown', name: 'Cooldown', desc: 'Minimum interval between trades per strategy' },
    { id: 'consensus', name: 'Consensus', desc: 'Require N/M Telegram votes for large trades' },
    { id: 'privacy', name: 'Privacy', desc: 'Route supported private-eligible actions through MagicBlock' },
  ];
}

/**
 * Get default policy config for a strategy type.
 */
export function getDefaultPolicies(strategyType) {
  const base = {
    'spend-limit': { perTick: 25, daily: 100, total: 1000 },
    'cooldown': { intervalMs: 60_000 },
  };

  switch (strategyType) {
    case 'dca':
      return { ...base, 'time-window': { startHour: 0, endHour: 24 } };
    case 'dip-buyer':
    case 'take-profit':
      return { ...base, 'price-guard': { maxSlippage: 3 } };
    case 'rebalancer':
      return {
        ...base,
        'price-guard': { maxSlippage: 3 },
        'spend-limit': { perTick: 50, daily: 200, total: 2000 },
      };
    case 'group':
      return {
        ...base,
        'consensus': { requiredVotes: 3, expiresInMinutes: 15 },
      };
    default:
      return base;
  }
}
