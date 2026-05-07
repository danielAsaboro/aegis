/**
 * Spend tracking utilities — thin wrappers over state store
 * for use by the policy engine.
 */

import { getSpendTracking, recordSpend } from '../store/state.mjs';

/**
 * Check if a proposed trade would exceed spend limits.
 * @param {string} strategyId
 * @param {number} proposedAmountUsd
 * @param {object} limits - { perTick, daily, total }
 * @returns {{ allowed: boolean, reason?: string, current: object }}
 */
export async function checkSpendLimits(strategyId, proposedAmountUsd, limits = {}) {
  const track = await getSpendTracking(strategyId);
  const amount = Number(proposedAmountUsd);

  if (limits.perTick && amount > limits.perTick) {
    return {
      allowed: false,
      reason: `Trade amount $${amount} exceeds per-tick limit of $${limits.perTick}`,
      current: track,
    };
  }

  if (limits.daily && (track.dailySpent + amount) > limits.daily) {
    return {
      allowed: false,
      reason: `Daily spend would be $${(track.dailySpent + amount).toFixed(2)}, exceeding daily limit of $${limits.daily}`,
      current: track,
    };
  }

  if (limits.total && (track.totalSpent + amount) > limits.total) {
    return {
      allowed: false,
      reason: `Total spend would be $${(track.totalSpent + amount).toFixed(2)}, exceeding lifetime limit of $${limits.total}`,
      current: track,
    };
  }

  return { allowed: true, current: track };
}

export { recordSpend, getSpendTracking };
