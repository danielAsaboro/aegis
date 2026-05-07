/**
 * Monitor / engine state — last prices, last-checked timestamps, spend
 * tracking, cooldowns.
 *
 * Backed by Prisma SQLite. All exports are async.
 */

import { getPrisma, closeDb, initDb, pushDbSchema } from '../db/index.mjs';
import { join } from 'node:path';

// ── Price State ────────────────────────────────────────────────────────────

export async function setPrice(token, chain, price) {
  const prisma = getPrisma();
  const num = Number(price);
  const existing = await prisma.priceState.findUnique({
    where: { token_chain: { token, chain } },
  });
  const data = existing
    ? { price: num, previousPrice: existing.price }
    : { token, chain, price: num, previousPrice: null };

  let row;
  if (existing) {
    row = await prisma.priceState.update({
      where: { token_chain: { token, chain } },
      data: { price: num, previousPrice: existing.price },
    });
  } else {
    row = await prisma.priceState.create({ data });
  }
  return {
    price: row.price,
    previousPrice: row.previousPrice,
    updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt,
  };
}

export async function getPrice(token, chain) {
  const row = await getPrisma().priceState.findUnique({
    where: { token_chain: { token, chain } },
  });
  if (!row) return null;
  return {
    price: row.price,
    previousPrice: row.previousPrice,
    updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt,
  };
}

export async function getAllPrices() {
  const rows = await getPrisma().priceState.findMany();
  const out = {};
  for (const r of rows) {
    out[`${r.token}:${r.chain}`] = {
      price: r.price,
      previousPrice: r.previousPrice,
      updatedAt: r.updatedAt?.toISOString?.() ?? r.updatedAt,
    };
  }
  return out;
}

// ── Spend Tracking ─────────────────────────────────────────────────────────

const MAX_HISTORY = 100;

function rowToSpend(row) {
  let history = [];
  try { history = JSON.parse(row.historyJson); } catch { history = []; }
  return {
    totalSpent: row.totalSpent,
    dailySpent: row.dailySpent,
    tickSpent: row.tickSpent,
    lastDayReset: row.lastDayReset,
    lastTickTime: row.lastTickTime?.toISOString?.() ?? row.lastTickTime,
    history,
  };
}

export async function recordSpend(strategyId, amountUsd) {
  const prisma = getPrisma();
  const amount = Number(amountUsd);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const existing = await prisma.spendTracking.findUnique({ where: { strategyId } });

  let history = [];
  let totalSpent = 0;
  let dailySpent = 0;
  let lastDayReset = today;

  if (existing) {
    try { history = JSON.parse(existing.historyJson); } catch { history = []; }
    totalSpent = existing.totalSpent;
    dailySpent = existing.lastDayReset === today ? existing.dailySpent : 0;
    lastDayReset = existing.lastDayReset === today ? existing.lastDayReset : today;
  }

  totalSpent += amount;
  dailySpent += amount;
  history.push({ amount, time: now.toISOString() });
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);

  const data = {
    totalSpent,
    dailySpent,
    tickSpent: amount,
    lastDayReset,
    lastTickTime: now,
    historyJson: JSON.stringify(history),
  };

  const row = existing
    ? await prisma.spendTracking.update({ where: { strategyId }, data })
    : await prisma.spendTracking.create({ data: { strategyId, ...data } });

  return rowToSpend(row);
}

export async function getSpendTracking(strategyId) {
  const row = await getPrisma().spendTracking.findUnique({ where: { strategyId } });
  if (!row) return { totalSpent: 0, dailySpent: 0, tickSpent: 0 };
  const today = new Date().toISOString().slice(0, 10);
  const tracking = rowToSpend(row);
  if (tracking.lastDayReset !== today) {
    tracking.dailySpent = 0;
    tracking.lastDayReset = today;
  }
  return tracking;
}

// ── Cooldowns ──────────────────────────────────────────────────────────────

export async function setCooldown(strategyId, durationMs) {
  const expiresAt = new Date(Date.now() + durationMs);
  await getPrisma().cooldown.upsert({
    where: { strategyId },
    update: { expiresAt },
    create: { strategyId, expiresAt },
  });
}

export async function isOnCooldown(strategyId) {
  const row = await getPrisma().cooldown.findUnique({ where: { strategyId } });
  if (!row) return false;
  return row.expiresAt > new Date();
}

export async function getCooldownRemaining(strategyId) {
  const row = await getPrisma().cooldown.findUnique({ where: { strategyId } });
  if (!row) return 0;
  return Math.max(0, row.expiresAt.getTime() - Date.now());
}

// ── Last Checked ───────────────────────────────────────────────────────────

export async function setLastChecked(monitorId) {
  await getPrisma().lastChecked.upsert({
    where: { monitorId },
    update: { checkedAt: new Date() },
    create: { monitorId, checkedAt: new Date() },
  });
}

export async function getLastChecked(monitorId) {
  const row = await getPrisma().lastChecked.findUnique({ where: { monitorId } });
  return row ? row.checkedAt.toISOString() : null;
}

export async function initStateStore(testDir) {
  process.env.DATA_DIR = testDir;
  process.env.AEGIS_DATABASE_URL = `file:${join(testDir, 'aegis.db')}`;
  pushDbSchema();
  await closeDb();
  await initDb();
}
