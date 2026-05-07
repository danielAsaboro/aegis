/**
 * AEGIS Mission service — the unifying primitive for autonomous intent.
 *
 * A Mission is an intent + policy envelope + budget + expiry the user
 * commits to once. Every DCA plan, dip-buy alert, rebalance target, group
 * proposal links to a Mission. The Mission owns the policy bundle the
 * approval gate consults; the strategy-specific row owns runtime config.
 *
 * Mission rules:
 *   - status starts at 'active'; transitions: paused, resumed, cancelled,
 *     done, exhausted, expired.
 *   - spentUsd is a denormalized rollup; the source of truth for spend
 *     accounting is engine/store/state.mjs (per strategyId).
 *   - policiesJson must be non-empty — runPolicies refuses empty configs.
 */

import { getPrisma } from '../db/index.mjs';
import { createLogger } from '../core/logger.mjs';
import { MissingPolicyConfigError } from '../policies/engine.mjs';

const log = createLogger('mission');

const VALID_KINDS = new Set(['dca', 'dip', 'rebalance', 'group', 'agent']);
const VALID_STATUSES = new Set([
  'active', 'paused', 'done', 'cancelled', 'exhausted', 'expired',
]);

function rowToMission(row) {
  if (!row) return null;
  let policies = {};
  try { policies = JSON.parse(row.policiesJson); } catch { /* keep {} */ }
  return {
    id: row.id,
    userId: row.userId,
    chatId: row.chatId,
    title: row.title,
    intent: row.intent,
    kind: row.kind,
    status: row.status,
    policies,
    budgetUsd: row.budgetUsd,
    spentUsd: row.spentUsd,
    perTxCapUsd: row.perTxCapUsd,
    startsAt: row.startsAt?.toISOString?.() ?? row.startsAt,
    expiresAt: row.expiresAt?.toISOString?.() ?? row.expiresAt,
    dcaPlanId: row.dcaPlanId,
    priceAlertId: row.priceAlertId,
    rebalanceTargetId: row.rebalanceTargetId,
    groupProposalId: row.groupProposalId,
    createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
    updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt,
  };
}

async function appendEvent(missionId, kind, payload) {
  const data = {
    missionId,
    kind,
    payloadJson: payload != null ? JSON.stringify(payload) : null,
  };
  return getPrisma().missionEvent.create({ data });
}

/**
 * Commit a new Mission. Throws MissingPolicyConfigError if the policy
 * envelope is empty — AEGIS does not support unscoped intents.
 */
export async function commitMission({
  userId,
  chatId,
  title,
  intent,
  kind,
  policies,
  budgetUsd,
  perTxCapUsd,
  expiresAt,
  dcaPlanId,
  priceAlertId,
  rebalanceTargetId,
  groupProposalId,
} = {}) {
  if (!userId) throw new Error('commitMission: userId required');
  if (!kind || !VALID_KINDS.has(kind)) {
    throw new Error(`commitMission: invalid kind "${kind}" (expected one of ${[...VALID_KINDS].join(', ')})`);
  }
  if (!policies || typeof policies !== 'object' || Object.keys(policies).length === 0) {
    throw new MissingPolicyConfigError(`mission-${kind}`);
  }

  const data = {
    userId: String(userId),
    chatId: chatId != null ? String(chatId) : null,
    title: title || `${kind} mission`,
    intent: intent || '',
    kind,
    status: 'active',
    policiesJson: JSON.stringify(policies),
    budgetUsd: budgetUsd != null ? Number(budgetUsd) : null,
    perTxCapUsd: perTxCapUsd != null ? Number(perTxCapUsd) : null,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
    dcaPlanId: dcaPlanId || null,
    priceAlertId: priceAlertId || null,
    rebalanceTargetId: rebalanceTargetId || null,
    groupProposalId: groupProposalId || null,
  };

  const row = await getPrisma().mission.create({ data });
  await appendEvent(row.id, 'committed', { kind, title: data.title, budgetUsd, perTxCapUsd });
  log.info({ missionId: row.id, kind, userId }, 'Mission committed');
  return rowToMission(row);
}

export async function getMission(id) {
  const row = await getPrisma().mission.findUnique({ where: { id } });
  return rowToMission(row);
}

export async function listMissions({ userId, chatId, status } = {}) {
  const where = {};
  if (userId != null) where.userId = String(userId);
  if (chatId != null) where.chatId = String(chatId);
  if (status) where.status = status;
  const rows = await getPrisma().mission.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(rowToMission);
}

export async function pauseMission(id, reason) {
  const row = await getPrisma().mission.update({
    where: { id },
    data: { status: 'paused' },
  });
  await appendEvent(id, 'paused', reason ? { reason } : null);
  log.info({ missionId: id }, 'Mission paused');
  return rowToMission(row);
}

export async function resumeMission(id) {
  const row = await getPrisma().mission.update({
    where: { id },
    data: { status: 'active' },
  });
  await appendEvent(id, 'resumed', null);
  log.info({ missionId: id }, 'Mission resumed');
  return rowToMission(row);
}

export async function cancelMission(id, reason) {
  const row = await getPrisma().mission.update({
    where: { id },
    data: { status: 'cancelled' },
  });
  await appendEvent(id, 'cancelled', reason ? { reason } : null);
  log.info({ missionId: id }, 'Mission cancelled');
  return rowToMission(row);
}

export async function completeMission(id, payload) {
  const row = await getPrisma().mission.update({
    where: { id },
    data: { status: 'done' },
  });
  await appendEvent(id, 'completed', payload || null);
  log.info({ missionId: id }, 'Mission completed');
  return rowToMission(row);
}

export async function recordMissionTick({ missionId, signal }) {
  if (!missionId) return null;
  await appendEvent(missionId, 'tick', signal ? {
    signalType: signal.type,
    timestamp: signal.timestamp,
  } : null);
  return true;
}

/**
 * Record a successful trade against a mission. Bumps spentUsd and, if
 * budgetUsd is set, marks the mission 'exhausted' once the budget is met.
 */
export async function recordMissionTrade({ missionId, executionId, amountUsd, txHash }) {
  if (!missionId) return null;
  const prisma = getPrisma();
  const usd = Number(amountUsd) || 0;

  const updated = await prisma.mission.update({
    where: { id: missionId },
    data: { spentUsd: { increment: usd } },
  });

  await appendEvent(missionId, 'trade', { executionId, amountUsd: usd, txHash });

  if (updated.budgetUsd != null && updated.spentUsd >= updated.budgetUsd) {
    await prisma.mission.update({
      where: { id: missionId },
      data: { status: 'exhausted' },
    });
    await appendEvent(missionId, 'exhausted', {
      spentUsd: updated.spentUsd,
      budgetUsd: updated.budgetUsd,
    });
    log.info({ missionId, spentUsd: updated.spentUsd }, 'Mission exhausted (budget reached)');
  } else if (
    updated.budgetUsd != null &&
    updated.spentUsd / updated.budgetUsd >= 0.8
  ) {
    await appendEvent(missionId, 'budget_warning', {
      spentUsd: updated.spentUsd,
      budgetUsd: updated.budgetUsd,
      pct: Math.round((updated.spentUsd / updated.budgetUsd) * 100),
    });
  }

  return rowToMission(updated);
}

export async function recordMissionDenial({ missionId, deniedBy, reason }) {
  if (!missionId) return null;
  await appendEvent(missionId, 'denied', { deniedBy, reason });
  return true;
}

export async function recordMissionExcursion({ missionId, proposalId, amountUsd, capUsd }) {
  if (!missionId) return null;
  await appendEvent(missionId, 'excursion', { proposalId, amountUsd, capUsd });
  return true;
}

/**
 * Look up the most-recently-active mission that should govern a given
 * chat-driven tool call. The match is intentionally loose — a user may
 * commit "DCA SOL" and then ask the agent for an unrelated swap; the gate
 * only auto-approves when the active mission's policies cover the trade
 * (matching kind 'agent' is the explicit blanket envelope).
 */
export async function findActiveMissionForCall({ userId, chatId, kind } = {}) {
  const where = { status: 'active' };
  if (userId != null) where.userId = String(userId);
  if (chatId != null) where.chatId = String(chatId);
  if (kind) where.kind = kind;
  const row = await getPrisma().mission.findFirst({
    where,
    orderBy: { createdAt: 'desc' },
  });
  return rowToMission(row);
}

/**
 * Sweep missions that should transition out of 'active' on time/budget
 * grounds. Returns the count of missions touched.
 */
export async function sweepExpiredMissions(now = new Date()) {
  const prisma = getPrisma();
  const stale = await prisma.mission.findMany({
    where: {
      status: 'active',
      expiresAt: { not: null, lt: now },
    },
  });
  for (const row of stale) {
    await prisma.mission.update({
      where: { id: row.id },
      data: { status: 'expired' },
    });
    await appendEvent(row.id, 'expired', { expiresAt: row.expiresAt });
  }
  if (stale.length > 0) {
    log.info({ count: stale.length }, 'Missions expired by sweeper');
  }
  return stale.length;
}

export async function getMissionEvents(missionId, { limit = 50 } = {}) {
  const rows = await getPrisma().missionEvent.findMany({
    where: { missionId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    missionId: r.missionId,
    kind: r.kind,
    payload: r.payloadJson ? JSON.parse(r.payloadJson) : null,
    createdAt: r.createdAt?.toISOString?.() ?? r.createdAt,
  }));
}

export { VALID_KINDS, VALID_STATUSES };
