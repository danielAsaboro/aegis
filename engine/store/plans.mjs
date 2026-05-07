/**
 * DCA Plans, Rebalance Targets, Price Alerts, Group Proposals, Whale Watches.
 * Backed by Prisma SQLite. All exports are async — callers await every read
 * and write.
 */

import { getPrisma, closeDb, initDb, pushDbSchema } from '../db/index.mjs';
import { storeLog } from '../core/logger.mjs';
import { join } from 'node:path';

function parseJson(raw, fallback) {
  if (raw == null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

// ── DCA Plans ──────────────────────────────────────────────────────────────

function rowToDCAPlan(row) {
  return {
    id: row.id,
    type: 'dca',
    fromToken: row.fromToken,
    toToken: row.toToken,
    amount: row.amount,
    chain: row.chain,
    cron: row.cron,
    status: row.status,
    policies: parseJson(row.policiesJson, {}),
    chatId: row.chatId,
    forcePrivate: row.forcePrivate,
    totalExecuted: row.totalExecuted,
    totalSpent: row.totalSpent,
    createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
  };
}

export async function addDCAPlan(plan) {
  await getPrisma().dCAPlan.create({
    data: {
      id: plan.id,
      fromToken: plan.fromToken,
      toToken: plan.toToken,
      amount: String(plan.amount),
      chain: plan.chain,
      cron: plan.cron,
      status: plan.status || 'active',
      policiesJson: JSON.stringify(plan.policies || {}),
      chatId: plan.chatId != null ? String(plan.chatId) : null,
      forcePrivate: !!plan.forcePrivate,
      totalExecuted: plan.totalExecuted || 0,
      totalSpent: plan.totalSpent || 0,
    },
  });
  storeLog.info({ planId: plan.id }, 'DCA plan created');
  return plan;
}

export async function getDCAPlans(chatId) {
  const where = chatId != null ? { chatId: String(chatId) } : {};
  const rows = await getPrisma().dCAPlan.findMany({ where, orderBy: { createdAt: 'desc' } });
  return rows.map(rowToDCAPlan);
}

export async function clearDCAPlans(chatId) {
  const where = chatId != null ? { chatId: String(chatId) } : {};
  await getPrisma().dCAPlan.deleteMany({ where });
}

export async function getDCAPlan(planId) {
  const row = await getPrisma().dCAPlan.findUnique({ where: { id: planId } });
  return row ? rowToDCAPlan(row) : null;
}

export async function updateDCAPlan(planId, updates) {
  const data = {};
  if (updates.status !== undefined) data.status = updates.status;
  if (updates.cron !== undefined) data.cron = updates.cron;
  if (updates.amount !== undefined) data.amount = String(updates.amount);
  if (updates.policies !== undefined) data.policiesJson = JSON.stringify(updates.policies);
  if (updates.totalExecuted !== undefined) data.totalExecuted = updates.totalExecuted;
  if (updates.totalSpent !== undefined) data.totalSpent = updates.totalSpent;
  if (updates.forcePrivate !== undefined) data.forcePrivate = !!updates.forcePrivate;

  try {
    const row = await getPrisma().dCAPlan.update({ where: { id: planId }, data });
    return rowToDCAPlan(row);
  } catch {
    return null;
  }
}

export async function getActiveDCAPlans() {
  const rows = await getPrisma().dCAPlan.findMany({ where: { status: 'active' } });
  return rows.map(rowToDCAPlan);
}

// ── Rebalance Targets ──────────────────────────────────────────────────────

function rowToRebalance(row) {
  return {
    id: row.id,
    type: 'rebalance',
    chatId: row.chatId,
    chain: row.chain,
    targets: parseJson(row.targetsJson, []),
    threshold: row.threshold,
    policies: parseJson(row.policiesJson, {}),
    status: row.status,
    createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
  };
}

export async function setRebalanceTarget(target) {
  const prisma = getPrisma();
  // Replace existing target for same chatId+chain
  const existing = await prisma.rebalanceTarget.findFirst({
    where: {
      chatId: target.chatId != null ? String(target.chatId) : null,
      chain: target.chain,
    },
  });

  const data = {
    chatId: target.chatId != null ? String(target.chatId) : null,
    chain: target.chain,
    targetsJson: JSON.stringify(target.targets || []),
    threshold: target.threshold ?? 5,
    policiesJson: JSON.stringify(target.policies || {}),
    status: target.status || 'active',
  };

  if (existing) {
    await prisma.rebalanceTarget.update({ where: { id: existing.id }, data });
  } else {
    await prisma.rebalanceTarget.create({ data: { id: target.id, ...data } });
  }
  storeLog.info({ targetId: target.id }, 'Rebalance target set');
  return target;
}

export async function getRebalanceTargets(chatId) {
  const where = chatId != null ? { chatId: String(chatId) } : {};
  const rows = await getPrisma().rebalanceTarget.findMany({ where });
  return rows.map(rowToRebalance);
}

export async function getActiveRebalanceTargets() {
  const rows = await getPrisma().rebalanceTarget.findMany({ where: { status: 'active' } });
  return rows.map(rowToRebalance);
}

export async function updateRebalanceTarget(targetId, updates) {
  const data = {};
  if (updates.status !== undefined) data.status = updates.status;
  if (updates.threshold !== undefined) data.threshold = updates.threshold;
  if (updates.targets !== undefined) data.targetsJson = JSON.stringify(updates.targets);
  if (updates.policies !== undefined) data.policiesJson = JSON.stringify(updates.policies);

  try {
    const row = await getPrisma().rebalanceTarget.update({ where: { id: targetId }, data });
    return rowToRebalance(row);
  } catch {
    return null;
  }
}

// ── Price Alerts ───────────────────────────────────────────────────────────

function rowToAlert(row) {
  return {
    id: row.id,
    token: row.token,
    chain: row.chain,
    type: row.type,
    direction: row.direction,
    threshold: row.threshold,
    buyToken: row.buyToken,
    buyAmount: row.buyAmount,
    policies: parseJson(row.policiesJson, {}),
    chatId: row.chatId,
    status: row.status,
    referencePrice: row.referencePrice,
    createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
  };
}

export async function addPriceAlert(alert) {
  await getPrisma().priceAlert.create({
    data: {
      id: alert.id,
      token: alert.token,
      chain: alert.chain,
      type: alert.type,
      direction: alert.direction,
      threshold: Number(alert.threshold),
      buyToken: alert.buyToken || null,
      buyAmount: alert.buyAmount ? String(alert.buyAmount) : null,
      policiesJson: JSON.stringify(alert.policies || {}),
      chatId: alert.chatId != null ? String(alert.chatId) : null,
      status: alert.status || 'active',
      referencePrice: alert.referencePrice ?? null,
    },
  });
  storeLog.info({ alertId: alert.id }, 'Price alert created');
  return alert;
}

export async function getPriceAlerts(chatId) {
  const where = chatId != null ? { chatId: String(chatId) } : {};
  const rows = await getPrisma().priceAlert.findMany({ where, orderBy: { createdAt: 'desc' } });
  return rows.map(rowToAlert);
}

export async function addAlert(alert) {
  return addPriceAlert({
    ...alert,
    direction: alert.direction || (alert.type === 'take_profit' ? 'above' : 'below'),
    type: alert.type === 'price_dip' ? 'dip-buyer' : alert.type === 'take_profit' ? 'take-profit' : alert.type,
    buyToken: alert.buyToken || 'USDC',
    buyAmount: alert.buyAmount ?? alert.amount ?? null,
  });
}

export async function getAlerts(chatId) {
  const rows = await getPriceAlerts(chatId);
  return rows.map((row) => ({
    ...row,
    type: row.type === 'dip-buyer' ? 'price_dip' : row.type === 'take-profit' ? 'take_profit' : row.type,
    amount: row.buyAmount,
  }));
}

export async function clearAlerts(chatId) {
  const where = chatId != null ? { chatId: String(chatId) } : {};
  await getPrisma().priceAlert.deleteMany({ where });
}

export async function getActivePriceAlerts() {
  const rows = await getPrisma().priceAlert.findMany({ where: { status: 'active' } });
  return rows.map(rowToAlert);
}

export async function updatePriceAlert(alertId, updates) {
  const data = {};
  if (updates.status !== undefined) data.status = updates.status;
  if (updates.threshold !== undefined) data.threshold = Number(updates.threshold);
  if (updates.referencePrice !== undefined) data.referencePrice = updates.referencePrice;
  if (updates.buyToken !== undefined) data.buyToken = updates.buyToken;
  if (updates.buyAmount !== undefined) data.buyAmount = updates.buyAmount ? String(updates.buyAmount) : null;
  if (updates.policies !== undefined) data.policiesJson = JSON.stringify(updates.policies);

  try {
    const row = await getPrisma().priceAlert.update({ where: { id: alertId }, data });
    return rowToAlert(row);
  } catch {
    return null;
  }
}

// ── Group Proposals ────────────────────────────────────────────────────────

function rowToProposal(row) {
  return {
    id: row.id,
    fromToken: row.fromToken,
    toToken: row.toToken,
    amount: row.amount,
    chain: row.chain,
    proposerId: row.proposerId,
    proposerName: row.proposerName,
    chatId: row.chatId,
    requiredVotes: row.requiredVotes,
    votes: parseJson(row.votesJson, {}),
    expiresAt: row.expiresAt?.toISOString?.() ?? row.expiresAt,
    status: row.status,
    createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
  };
}

export async function addProposal(proposal) {
  await getPrisma().groupProposal.create({
    data: {
      id: proposal.id,
      fromToken: proposal.fromToken,
      toToken: proposal.toToken,
      amount: String(proposal.amount),
      chain: proposal.chain,
      proposerId: String(proposal.proposerId),
      proposerName: proposal.proposerName,
      chatId: String(proposal.chatId),
      requiredVotes: proposal.requiredVotes,
      votesJson: JSON.stringify(proposal.votes || {}),
      expiresAt: new Date(proposal.expiresAt),
      status: proposal.status || 'voting',
    },
  });
  storeLog.info({ proposalId: proposal.id }, 'Proposal created');
  return proposal;
}

export async function getProposal(proposalId) {
  const row = await getPrisma().groupProposal.findUnique({ where: { id: proposalId } });
  return row ? rowToProposal(row) : null;
}

export async function getActiveProposals(chatId) {
  const where = { status: 'voting' };
  if (chatId != null) where.chatId = String(chatId);
  const rows = await getPrisma().groupProposal.findMany({ where, orderBy: { createdAt: 'desc' } });
  return rows.map(rowToProposal);
}

export async function getProposals(chatId) {
  const where = chatId != null ? { chatId: String(chatId) } : {};
  const rows = await getPrisma().groupProposal.findMany({ where, orderBy: { createdAt: 'desc' } });
  return rows.map(rowToProposal);
}

export async function updateProposal(proposalId, updates) {
  const data = {};
  if (updates.status !== undefined) data.status = updates.status;
  if (updates.votes !== undefined) data.votesJson = JSON.stringify(updates.votes);
  if (updates.requiredVotes !== undefined) data.requiredVotes = updates.requiredVotes;
  if (updates.expiresAt !== undefined) data.expiresAt = new Date(updates.expiresAt);

  try {
    const row = await getPrisma().groupProposal.update({ where: { id: proposalId }, data });
    return rowToProposal(row);
  } catch {
    return null;
  }
}

export async function clearProposals(chatId) {
  const where = chatId != null ? { chatId: String(chatId) } : {};
  await getPrisma().groupProposal.deleteMany({ where });
}

export async function initPlansStore(testDir) {
  process.env.DATA_DIR = testDir;
  process.env.AEGIS_DATABASE_URL = `file:${join(testDir, 'aegis.db')}`;
  pushDbSchema();
  await closeDb();
  await initDb();
}

// ── Whale Watches ──────────────────────────────────────────────────────────

function rowToWatch(row) {
  return {
    address: row.address,
    label: row.label || '',
    chatId: row.chatId,
    createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
  };
}

export async function addWhaleWatch(chatId, address, label = '') {
  const prisma = getPrisma();
  const existing = await prisma.whaleWatch.findUnique({
    where: { chatId_address: { chatId: String(chatId), address } },
  });
  if (existing) return rowToWatch(existing);
  const row = await prisma.whaleWatch.create({
    data: { chatId: String(chatId), address, label: label || null },
  });
  return rowToWatch(row);
}

export async function getWhaleWatches(chatId) {
  const where = chatId != null ? { chatId: String(chatId) } : {};
  const rows = await getPrisma().whaleWatch.findMany({ where });
  return rows.map(rowToWatch);
}

export async function removeWhaleWatch(chatId, address) {
  const result = await getPrisma().whaleWatch.deleteMany({
    where: { chatId: String(chatId), address },
  });
  return result.count > 0;
}
