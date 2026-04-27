/**
 * Shielded Balance Store — tracks MagicBlock private balances locally.
 *
 * Balances are synced from chain on demand and cached locally for quick access.
 * JSON file storage at DATA_DIR/shield.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { storeLog } from '../core/logger.mjs';

let DATA_DIR;
let SHIELD_PATH;
let _cache = null;

/**
 * Initialize the shield store.
 */
export function initShieldStore(dataDir) {
  DATA_DIR = dataDir;
  SHIELD_PATH = join(DATA_DIR, 'shield.json');
  mkdirSync(DATA_DIR, { recursive: true });
  _cache = null;
}

function load() {
  if (_cache) return _cache;
  if (!existsSync(SHIELD_PATH)) {
    _cache = { balances: {}, history: [] };
    return _cache;
  }
  try {
    _cache = JSON.parse(readFileSync(SHIELD_PATH, 'utf-8'));
    return _cache;
  } catch (err) {
    storeLog.warn({ err }, 'Failed to read shield store, starting fresh');
    _cache = { balances: {}, history: [] };
    return _cache;
  }
}

function save() {
  writeFileSync(SHIELD_PATH, JSON.stringify(_cache, null, 2) + '\n');
}

// ─── Balance Tracking ────────────────────────────────────────────────────────

/**
 * Get shielded balance for a wallet + token.
 *
 * @param {string} wallet - Wallet public key
 * @param {string} token - Token symbol (SOL, USDC, etc.)
 * @returns {bigint} Balance in raw units (0 if not found)
 */
export function getShieldBalance(wallet, token) {
  const data = load();
  const key = `${wallet}:${token.toUpperCase()}`;
  const raw = data.balances[key];
  return raw ? BigInt(raw) : 0n;
}

/**
 * Get all shielded balances for a wallet.
 *
 * @param {string} wallet - Wallet public key
 * @returns {Record<string, bigint>} Map of token -> balance
 */
export function getShieldBalances(wallet) {
  const data = load();
  const prefix = `${wallet}:`;
  const result = {};

  for (const [key, value] of Object.entries(data.balances)) {
    if (key.startsWith(prefix)) {
      const token = key.slice(prefix.length);
      result[token] = BigInt(value);
    }
  }

  return result;
}

/**
 * Update shielded balance for a wallet + token.
 *
 * @param {string} wallet - Wallet public key
 * @param {string} token - Token symbol
 * @param {bigint|string|number} balance - New balance in raw units
 */
export function updateShieldBalance(wallet, token, balance) {
  const data = load();
  const key = `${wallet}:${token.toUpperCase()}`;
  const balanceStr = typeof balance === 'bigint' ? balance.toString() : String(balance);

  const oldBalance = data.balances[key];
  data.balances[key] = balanceStr;
  save();

  storeLog.debug({ wallet: wallet.slice(0, 8), token, balance: balanceStr }, 'Shield balance updated');
  return BigInt(balanceStr);
}

/**
 * Clear shielded balance (set to 0).
 */
export function clearShieldBalance(wallet, token) {
  return updateShieldBalance(wallet, token, 0n);
}

// ─── Transaction History ─────────────────────────────────────────────────────

/**
 * Record a shield transaction (deposit, withdraw, transfer).
 *
 * @param {object} tx - Transaction details
 * @param {string} tx.type - 'deposit' | 'withdraw' | 'transfer'
 * @param {string} tx.wallet - Wallet public key
 * @param {string} tx.token - Token symbol
 * @param {string|number} tx.amount - Amount in raw units
 * @param {string} [tx.signature] - Transaction signature
 * @param {string} [tx.recipient] - Recipient for transfers
 */
export function recordShieldTransaction(tx) {
  const data = load();

  const entry = {
    id: `shield-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: tx.type,
    wallet: tx.wallet,
    token: tx.token.toUpperCase(),
    amount: String(tx.amount),
    signature: tx.signature || null,
    recipient: tx.recipient || null,
    timestamp: new Date().toISOString(),
  };

  data.history.push(entry);

  // Keep last 100 transactions
  if (data.history.length > 100) {
    data.history = data.history.slice(-100);
  }

  save();
  storeLog.info({ tx: entry.id, type: entry.type, token: entry.token }, 'Shield transaction recorded');
  return entry;
}

/**
 * Get shield transaction history for a wallet.
 *
 * @param {string} wallet - Wallet public key
 * @param {number} [limit=20] - Max transactions to return
 * @returns {Array} Transaction history, newest first
 */
export function getShieldHistory(wallet, limit = 20) {
  const data = load();
  return data.history
    .filter(tx => tx.wallet === wallet)
    .slice(-limit)
    .reverse();
}

/**
 * Get all shield transaction history.
 *
 * @param {number} [limit=50] - Max transactions to return
 * @returns {Array} Transaction history, newest first
 */
export function getAllShieldHistory(limit = 50) {
  const data = load();
  return data.history.slice(-limit).reverse();
}

// ─── Utility ─────────────────────────────────────────────────────────────────

/**
 * Invalidate the cache (force reload on next access).
 */
export function invalidateShieldCache() {
  _cache = null;
}

/**
 * Get summary of all shielded balances across all wallets.
 */
export function getShieldSummary() {
  const data = load();
  const byToken = {};

  for (const [key, value] of Object.entries(data.balances)) {
    const [, token] = key.split(':');
    if (!byToken[token]) byToken[token] = 0n;
    byToken[token] += BigInt(value);
  }

  return {
    totalWallets: new Set(Object.keys(data.balances).map(k => k.split(':')[0])).size,
    byToken,
    transactionCount: data.history.length,
  };
}
