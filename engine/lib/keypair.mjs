/**
 * Keypair loading utility for MagicBlock private execution.
 *
 * Supports loading Solana keypair from:
 * - Base58-encoded private key
 * - JSON array of bytes [u8; 64]
 * - Raw Uint8Array
 */

import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import env from '../config.mjs';
import { createLogger } from '../core/logger.mjs';

const log = createLogger('keypair');

let _cachedKeypair = null;

/**
 * Load keypair from SOLANA_PRIVATE_KEY env var.
 * Caches the result for subsequent calls.
 *
 * @returns {Keypair|null} Keypair if available, null otherwise
 */
export function getKeypair() {
  if (_cachedKeypair) return _cachedKeypair;

  const key = process.env.SOLANA_PRIVATE_KEY || env.SOLANA_PRIVATE_KEY;
  if (!key) {
    log.debug('SOLANA_PRIVATE_KEY not set');
    return null;
  }

  try {
    _cachedKeypair = parseKeypair(key);
    log.info({ pubkey: _cachedKeypair.publicKey.toBase58() }, 'Keypair loaded for MagicBlock');
    return _cachedKeypair;
  } catch (err) {
    log.error({ err: err.message }, 'Failed to parse SOLANA_PRIVATE_KEY');
    return null;
  }
}

/**
 * Parse a keypair from various formats.
 *
 * @param {string|Uint8Array|number[]} input - Key in base58, JSON array, or bytes
 * @returns {Keypair}
 */
export function parseKeypair(input) {
  // Already a Uint8Array
  if (input instanceof Uint8Array) {
    return Keypair.fromSecretKey(input);
  }

  // Array of numbers (JSON parsed)
  if (Array.isArray(input)) {
    return Keypair.fromSecretKey(Uint8Array.from(input));
  }

  // String input
  if (typeof input === 'string') {
    const trimmed = input.trim();

    // JSON array format: [1,2,3,...]
    if (trimmed.startsWith('[')) {
      const bytes = JSON.parse(trimmed);
      return Keypair.fromSecretKey(Uint8Array.from(bytes));
    }

    // Base58 format
    try {
      const decoded = bs58.decode(trimmed);
      return Keypair.fromSecretKey(decoded);
    } catch {
      throw new Error('Invalid key format: expected base58 or JSON array');
    }
  }

  throw new Error(`Unsupported key type: ${typeof input}`);
}

/**
 * Clear cached keypair (for testing).
 */
export function clearKeypairCache() {
  _cachedKeypair = null;
}

/**
 * Check if a keypair is available.
 */
export function hasKeypair() {
  return !!(process.env.SOLANA_PRIVATE_KEY || env.SOLANA_PRIVATE_KEY);
}
