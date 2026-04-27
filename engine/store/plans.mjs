/**
 * DCA Plans, Rebalance Targets, and Price Alerts persistence.
 * JSON file storage at DATA_DIR/plans.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { storeLog } from '../core/logger.mjs';

let DATA_DIR;
let PLANS_PATH;
let _cache = null;

export function initPlansStore(dataDir) {
  DATA_DIR = dataDir;
  PLANS_PATH = join(DATA_DIR, 'plans.json');
  mkdirSync(DATA_DIR, { recursive: true });
  _cache = null;
}

function load() {
  if (_cache) return _cache;
  if (!existsSync(PLANS_PATH)) {
    _cache = { dca: [], rebalance: [], alerts: [], proposals: [], whaleWatches: [] };
    return _cache;
  }
  try {
    _cache = JSON.parse(readFileSync(PLANS_PATH, 'utf-8'));
    return _cache;
  } catch (err) {
    storeLog.warn({ err }, 'Failed to read plans, starting fresh');
    _cache = { dca: [], rebalance: [], alerts: [], proposals: [], whaleWatches: [] };
    return _cache;
  }
}

function save() {
  writeFileSync(PLANS_PATH, JSON.stringify(_cache, null, 2) + '\n');
}

// ─── DCA Plans ───────────────────────────────────────────────────────────────

export function addDCAPlan(plan) {
  const data = load();
  data.dca.push(plan);
  save();
  storeLog.info({ planId: plan.id }, 'DCA plan created');
  return plan;
}

export function getDCAPlans(chatId) {
  return load().dca.filter(p => !chatId || p.chatId === chatId);
}

export function getDCAPlan(planId) {
  return load().dca.find(p => p.id === planId) || null;
}

export function updateDCAPlan(planId, updates) {
  const data = load();
  const idx = data.dca.findIndex(p => p.id === planId);
  if (idx === -1) return null;
  Object.assign(data.dca[idx], updates);
  save();
  return data.dca[idx];
}

export function getActiveDCAPlans() {
  return load().dca.filter(p => p.status === 'active');
}

// ─── Rebalance Targets ───────────────────────────────────────────────────────

export function setRebalanceTarget(target) {
  const data = load();
  // Replace existing target for same chatId+chain
  const idx = data.rebalance.findIndex(r => r.chatId === target.chatId && r.chain === target.chain);
  if (idx >= 0) {
    data.rebalance[idx] = target;
  } else {
    data.rebalance.push(target);
  }
  save();
  storeLog.info({ targetId: target.id }, 'Rebalance target set');
  return target;
}

export function getRebalanceTargets(chatId) {
  return load().rebalance.filter(r => !chatId || r.chatId === chatId);
}

export function getActiveRebalanceTargets() {
  return load().rebalance.filter(r => r.status === 'active');
}

export function updateRebalanceTarget(targetId, updates) {
  const data = load();
  const idx = data.rebalance.findIndex(r => r.id === targetId);
  if (idx === -1) return null;
  Object.assign(data.rebalance[idx], updates);
  save();
  return data.rebalance[idx];
}

// ─── Price Alerts ────────────────────────────────────────────────────────────

export function addPriceAlert(alert) {
  const data = load();
  data.alerts.push(alert);
  save();
  storeLog.info({ alertId: alert.id }, 'Price alert created');
  return alert;
}

export function getPriceAlerts(chatId) {
  return load().alerts.filter(a => !chatId || a.chatId === chatId);
}

export function getActivePriceAlerts() {
  return load().alerts.filter(a => a.status === 'active');
}

export function updatePriceAlert(alertId, updates) {
  const data = load();
  const idx = data.alerts.findIndex(a => a.id === alertId);
  if (idx === -1) return null;
  Object.assign(data.alerts[idx], updates);
  save();
  return data.alerts[idx];
}

// ─── Group Proposals ─────────────────────────────────────────────────────────

export function addProposal(proposal) {
  const data = load();
  data.proposals.push(proposal);
  save();
  storeLog.info({ proposalId: proposal.id }, 'Proposal created');
  return proposal;
}

export function getProposal(proposalId) {
  return load().proposals.find(p => p.id === proposalId) || null;
}

export function getActiveProposals(chatId) {
  return load().proposals.filter(p => p.status === 'voting' && (!chatId || p.chatId === chatId));
}

export function updateProposal(proposalId, updates) {
  const data = load();
  const idx = data.proposals.findIndex(p => p.id === proposalId);
  if (idx === -1) return null;
  Object.assign(data.proposals[idx], updates);
  save();
  return data.proposals[idx];
}

// ─── Whale Watches ───────────────────────────────────────────────────────────

export function addWhaleWatch(chatId, address, label = '') {
  const data = load();
  if (!data.whaleWatches) data.whaleWatches = [];
  const existing = data.whaleWatches.find(w => w.chatId === chatId && w.address === address);
  if (existing) return existing;
  const watch = { address, label, chatId, createdAt: new Date().toISOString() };
  data.whaleWatches.push(watch);
  save();
  return watch;
}

export function getWhaleWatches(chatId) {
  const data = load();
  return (data.whaleWatches || []).filter(w => !chatId || w.chatId === chatId);
}

export function removeWhaleWatch(chatId, address) {
  const data = load();
  if (!data.whaleWatches) return false;
  const idx = data.whaleWatches.findIndex(w => w.chatId === chatId && w.address === address);
  if (idx === -1) return false;
  data.whaleWatches.splice(idx, 1);
  save();
  return true;
}

export function invalidateCache() {
  _cache = null;
}
