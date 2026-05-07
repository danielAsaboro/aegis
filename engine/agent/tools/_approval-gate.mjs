/**
 * Two-tier auto-approval gate.
 *
 * Today the SDK treats `needsApproval: true` as a static flag and emits
 * a `tool-approval-request` content part *before* execute() runs. That
 * means every value-moving tool call blocks on a human y/n — even when
 * an explicit policy envelope (a Mission) already covers the operation.
 *
 * This gate replaces that static flag with a dynamic check:
 *
 *   1. Find the most-recent active Mission for (userId, kind).
 *   2. If no mission → return TRUE (fall through to today's human y/n).
 *   3. If mission has no perTxCapUsd → return TRUE (no auto-approve cap
 *      means every trade still needs explicit human approval).
 *   4. Compute amountUsd via stablecoin shortcut or PriceState cache. If
 *      we can't determine USD value → return TRUE (fail closed on the
 *      auto-approve side; we never auto-approve a trade we can't price).
 *   5. If amountUsd ≤ perTxCapUsd → return FALSE (auto-approve; the gate
 *      inside execute() still runs policies, the executor still
 *      fail-closes on missing policyResult).
 *   6. Else (excursion) → return TRUE and emit an excursion notification.
 *
 * The policy engine still runs inside every execute() — auto-approval
 * only chooses *which* approval path runs (human y/n vs. policy-only),
 * never bypasses policies.
 */

import { findActiveMissionForCall, recordMissionExcursion } from '../../missions/index.mjs';
import { getPrice } from '../../store/state.mjs';
import { notify } from '../../notify/index.mjs';
import { createLogger } from '../../core/logger.mjs';

const log = createLogger('approval-gate');

const STABLES = new Set(['USDC', 'USDT', 'DAI', 'USD', 'BUSD', 'TUSD']);

/**
 * Compute USD value of `amount fromToken`. Returns null if we can't.
 */
async function estimateAmountUsd({ fromToken, amount, chain }) {
  const num = Number(amount);
  if (!Number.isFinite(num) || num <= 0) return null;
  const sym = String(fromToken || '').toUpperCase();
  if (STABLES.has(sym)) return num;
  if (chain) {
    try {
      const row = await getPrice(sym, chain);
      if (row && Number.isFinite(row.price) && row.price > 0) {
        return num * row.price;
      }
    } catch { /* fall through */ }
  }
  return null;
}

/**
 * Tool-level `needsApproval` function. Wire as:
 *
 *   needsApproval: needsApprovalGate({ kind: 'agent' })
 *
 * @param {object} cfg
 * @param {string} [cfg.kind='agent'] — Mission.kind to match. Most agent
 *   tools commit blanket 'agent' missions; DCA / dip / rebalance / group
 *   tools match their own kinds.
 * @returns {(input, ctx) => Promise<boolean>}
 */
export function needsApprovalGate({ kind = 'agent' } = {}) {
  return async function gate(input, ctx) {
    try {
      const userId = ctx?.experimental_context?.userId;
      const chatId = ctx?.experimental_context?.chatId;
      if (!userId) return true;

      const mission = await findActiveMissionForCall({ userId, chatId, kind });
      if (!mission) {
        log.debug({ userId, kind }, 'no active mission — fall through to human approval');
        return true;
      }
      if (mission.perTxCapUsd == null) {
        log.debug({ missionId: mission.id }, 'mission has no perTxCapUsd — human approval required');
        return true;
      }

      const fromToken = input?.fromToken || input?.token || 'USDC';
      const amount = input?.amount;
      const chain = input?.chain;
      const amountUsd = await estimateAmountUsd({ fromToken, amount, chain });

      if (amountUsd == null) {
        log.info({ missionId: mission.id, fromToken }, 'unable to price — falling through to human approval');
        return true;
      }

      if (amountUsd <= mission.perTxCapUsd) {
        log.info({ missionId: mission.id, amountUsd, capUsd: mission.perTxCapUsd }, 'auto-approving inside mission envelope');
        return false;
      }

      // Excursion — amount exceeds per-tx cap. Record an event + notify.
      await recordMissionExcursion({
        missionId: mission.id,
        proposalId: ctx?.toolCallId || null,
        amountUsd,
        capUsd: mission.perTxCapUsd,
      });
      try {
        await notify({
          level: 'excursion',
          title: `Excursion: $${amountUsd.toFixed(2)} > cap $${mission.perTxCapUsd.toFixed(2)}`,
          body: `${amount} ${fromToken} → ${input?.toToken || ''} on ${chain || 'default'} requires human approval (mission ${mission.title}).`,
          missionId: mission.id,
        });
      } catch (err) {
        log.warn({ err: err.message }, 'excursion notify failed');
      }
      return true;
    } catch (err) {
      log.warn({ err: err.message }, 'gate threw — defaulting to human approval');
      return true;
    }
  };
}

/**
 * Look up the active mission for a tool call (used inside execute() to
 * stamp proposal.missionId). Returns null when no mission applies.
 */
export async function resolveActiveMission(ctx, kind = 'agent') {
  const userId = ctx?.experimental_context?.userId;
  const chatId = ctx?.experimental_context?.chatId;
  if (!userId) return null;
  return findActiveMissionForCall({ userId, chatId, kind });
}

export { estimateAmountUsd };
