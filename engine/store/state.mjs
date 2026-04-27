/**
 * Monitor state persistence — last prices, last check times, etc.
 * JSON file storage at DATA_DIR/state.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { storeLog } from '../core/logger.mjs';

let DATA_DIR;
let STATE_PATH;
let _cache = null;

export function initStateStore(dataDir) {
  DATA_DIR = dataDir;
  STATE_PATH = join(DATA_DIR, 'state.json');
  mkdirSync(DATA_DIR, { recursive: true });
  _cache = null;
}

function load() {
  if (_cache) return _cache;
  if (!existsSync(STATE_PATH)) {
    _cache = { prices: {}, lastChecked: {}, spendTracking: {}, cooldowns: {} };
    return _cache;
  }
  try {
    _cache = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
    return _cache;
  } catch (err) {
    storeLog.warn({ err }, 'Failed to read state, starting fresh');
    _cache = { prices: {}, lastChecked: {}, spendTracking: {}, cooldowns: {} };
    return _cache;
  }
}

function save() {
  writeFileSync(STATE_PATH, JSON.stringify(_cache, null, 2) + '\n');
}

// ─── Price State ─────────────────────────────────────────────────────────────

export function setPrice(token, chain, price) {
  const data = load();
  const key = `${token}:${chain}`;
  const prev = data.prices[key];
  data.prices[key] = {
    price: Number(price),
    previousPrice: prev?.price || null,
    updatedAt: new Date().toISOString(),
  };
  save();
  return data.prices[key];
}

export function getPrice(token, chain) {
  const data = load();
  return data.prices[`${token}:${chain}`] || null;
}

export function getAllPrices() {
  return { ...load().prices };
}

// ─── Spend Tracking ──────────────────────────────────────────────────────────

export function recordSpend(strategyId, amountUsd) {
  const data = load();
  if (!data.spendTracking) data.spendTracking = {};
  const now = new Date().toISOString();
  if (!data.spendTracking[strategyId]) {
    data.spendTracking[strategyId] = {
      totalSpent: 0,
      dailySpent: 0,
      tickSpent: 0,
      lastDayReset: now.slice(0, 10),
      lastTickTime: now,
      history: [],
    };
  }
  const track = data.spendTracking[strategyId];

  // Reset daily if new day
  const today = now.slice(0, 10);
  if (track.lastDayReset !== today) {
    track.dailySpent = 0;
    track.lastDayReset = today;
  }

  track.totalSpent += Number(amountUsd);
  track.dailySpent += Number(amountUsd);
  track.tickSpent = Number(amountUsd);
  track.lastTickTime = now;
  track.history.push({ amount: Number(amountUsd), time: now });

  // Keep last 100 history entries
  if (track.history.length > 100) track.history = track.history.slice(-100);

  save();
  return track;
}

export function getSpendTracking(strategyId) {
  const data = load();
  const track = data.spendTracking?.[strategyId];
  if (!track) return { totalSpent: 0, dailySpent: 0, tickSpent: 0 };

  // Reset daily if stale
  const today = new Date().toISOString().slice(0, 10);
  if (track.lastDayReset !== today) {
    track.dailySpent = 0;
    track.lastDayReset = today;
  }
  return track;
}

// ─── Cooldowns ───────────────────────────────────────────────────────────────

export function setCooldown(strategyId, durationMs) {
  const data = load();
  if (!data.cooldowns) data.cooldowns = {};
  data.cooldowns[strategyId] = {
    expiresAt: new Date(Date.now() + durationMs).toISOString(),
  };
  save();
}

export function isOnCooldown(strategyId) {
  const data = load();
  const cd = data.cooldowns?.[strategyId];
  if (!cd) return false;
  return new Date(cd.expiresAt) > new Date();
}

export function getCooldownRemaining(strategyId) {
  const data = load();
  const cd = data.cooldowns?.[strategyId];
  if (!cd) return 0;
  const remaining = new Date(cd.expiresAt) - new Date();
  return Math.max(0, remaining);
}

// ─── Last Checked ────────────────────────────────────────────────────────────

export function setLastChecked(monitorId) {
  const data = load();
  if (!data.lastChecked) data.lastChecked = {};
  data.lastChecked[monitorId] = new Date().toISOString();
  save();
}

export function getLastChecked(monitorId) {
  const data = load();
  return data.lastChecked?.[monitorId] || null;
}

export function invalidateCache() {
  _cache = null;
}
