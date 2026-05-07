/**
 * Per-key rolling-hour invocation budget backed by AgentInvocation rows.
 *
 * The telemetry layer (engine/agent/telemetry.mjs) creates the canonical
 * AgentInvocation row on `experimental_onStart`. `recordInvocation` here is
 * a thin alias kept for callers (AgentStrategy) that want to reserve budget
 * before the LLM call kicks off — it inserts a placeholder row that the
 * telemetry layer will later update in place by id.
 */

import env from '../config.mjs';
import { getPrisma } from '../db/index.mjs';

const WINDOW_MS = 60 * 60 * 1000;

export async function withinBudget(key) {
  if (!key) return false;
  const since = new Date(Date.now() - WINDOW_MS);
  const count = await getPrisma().agentInvocation.count({
    where: { userId: String(key), startedAt: { gt: since } },
  });
  return count < env.AEGIS_AGENT_MAX_INVOCATIONS_PER_HOUR;
}

export async function remainingBudget(key) {
  if (!key) return 0;
  const since = new Date(Date.now() - WINDOW_MS);
  const count = await getPrisma().agentInvocation.count({
    where: { userId: String(key), startedAt: { gt: since } },
  });
  return Math.max(0, env.AEGIS_AGENT_MAX_INVOCATIONS_PER_HOUR - count);
}

/**
 * Optional pre-reservation. The canonical invocation row is created by the
 * telemetry callbacks; this is a no-op kept for back-compat.
 */
export async function recordInvocation(_key) {
  return;
}
