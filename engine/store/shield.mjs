/**
 * Shielded Balance store — MagicBlock private balances.
 *
 * Backed by Prisma SQLite. All exports are async.
 */

import { getPrisma, closeDb, initDb, pushDbSchema } from '../db/index.mjs';
import { storeLog } from '../core/logger.mjs';
import { join } from 'node:path';

const HISTORY_KEEP = 100;

// ── Balances ───────────────────────────────────────────────────────────────

export async function getShieldBalance(wallet, token) {
  const row = await getPrisma().shieldBalance.findUnique({
    where: { wallet_token: { wallet, token: token.toUpperCase() } },
  });
  return row ? BigInt(row.balance) : 0n;
}

export async function getShieldBalances(wallet) {
  const rows = await getPrisma().shieldBalance.findMany({ where: { wallet } });
  const out = {};
  for (const r of rows) out[r.token] = BigInt(r.balance);
  return out;
}

export async function updateShieldBalance(wallet, token, balance) {
  const balanceStr = typeof balance === 'bigint' ? balance.toString() : String(balance);
  const T = token.toUpperCase();
  await getPrisma().shieldBalance.upsert({
    where: { wallet_token: { wallet, token: T } },
    update: { balance: balanceStr },
    create: { wallet, token: T, balance: balanceStr },
  });
  storeLog.debug({ wallet: wallet.slice(0, 8), token: T, balance: balanceStr }, 'Shield balance updated');
  return BigInt(balanceStr);
}

export async function clearShieldBalance(wallet, token) {
  return updateShieldBalance(wallet, token, 0n);
}

// ── Transaction History ────────────────────────────────────────────────────

export async function recordShieldTransaction(tx) {
  const prisma = getPrisma();
  const T = tx.token.toUpperCase();
  const created = await prisma.shieldTransaction.create({
    data: {
      type: tx.type,
      wallet: tx.wallet,
      token: T,
      amount: String(tx.amount),
      signature: tx.signature || '',
      recipient: tx.recipient || null,
    },
  });

  // Trim history per wallet to last HISTORY_KEEP rows
  const total = await prisma.shieldTransaction.count({ where: { wallet: tx.wallet } });
  if (total > HISTORY_KEEP) {
    const excess = total - HISTORY_KEEP;
    const oldest = await prisma.shieldTransaction.findMany({
      where: { wallet: tx.wallet },
      orderBy: { createdAt: 'asc' },
      take: excess,
      select: { id: true },
    });
    if (oldest.length > 0) {
      await prisma.shieldTransaction.deleteMany({
        where: { id: { in: oldest.map(o => o.id) } },
      });
    }
  }

  const entry = {
    id: `shield-${created.id}`,
    type: created.type,
    wallet: created.wallet,
    token: created.token,
    amount: created.amount,
    signature: created.signature,
    recipient: created.recipient,
    timestamp: created.createdAt.toISOString(),
  };
  storeLog.info({ tx: entry.id, type: entry.type, token: entry.token }, 'Shield transaction recorded');
  return entry;
}

export async function getShieldHistory(wallet, limit = 20) {
  const rows = await getPrisma().shieldTransaction.findMany({
    where: { wallet },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map(r => ({
    id: `shield-${r.id}`,
    type: r.type,
    wallet: r.wallet,
    token: r.token,
    amount: r.amount,
    signature: r.signature,
    recipient: r.recipient,
    timestamp: r.createdAt.toISOString(),
  }));
}

export async function getAllShieldHistory(limit = 50) {
  const rows = await getPrisma().shieldTransaction.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map(r => ({
    id: `shield-${r.id}`,
    type: r.type,
    wallet: r.wallet,
    token: r.token,
    amount: r.amount,
    signature: r.signature,
    recipient: r.recipient,
    timestamp: r.createdAt.toISOString(),
  }));
}

export async function getShieldSummary() {
  const rows = await getPrisma().shieldBalance.findMany();
  const byToken = {};
  const wallets = new Set();
  for (const r of rows) {
    wallets.add(r.wallet);
    if (!byToken[r.token]) byToken[r.token] = 0n;
    byToken[r.token] += BigInt(r.balance);
  }
  const txCount = await getPrisma().shieldTransaction.count();
  return {
    totalWallets: wallets.size,
    byToken,
    transactionCount: txCount,
  };
}

export async function initShieldStore(testDir) {
  process.env.DATA_DIR = testDir;
  process.env.AEGIS_DATABASE_URL = `file:${join(testDir, 'aegis.db')}`;
  pushDbSchema();
  await closeDb();
  await initDb();
}
