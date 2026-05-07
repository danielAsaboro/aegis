/**
 * MagicBlock Private Payments Client
 *
 * Wraps the @magicblock-labs/ephemeral-rollups-sdk for private execution.
 * Provides deposit, transfer, withdraw, and balance operations.
 *
 * Updated for SDK v0.10.5 (new high-level API)
 */

import {
  Connection,
  PublicKey,
  Transaction,
  Keypair,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createTransferCheckedInstruction,
  getAccount,
} from '@solana/spl-token';
import {
  deriveEphemeralAta,
  delegateSpl,
  withdrawSpl as withdrawSplIxs,
} from '@magicblock-labs/ephemeral-rollups-sdk';

// Default private validator. Pulled from the live `devnet.magicblock.app`
// ephemeral rollup via `getIdentity` — must match the validator actually
// running the rollup or delegated accounts get stranded.
//   curl -X POST https://devnet.magicblock.app \
//     -H 'Content-Type: application/json' \
//     -d '{"jsonrpc":"2.0","id":1,"method":"getIdentity"}'
const DEFAULT_PRIVATE_VALIDATOR = new PublicKey('MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57');
import env from '../../config.mjs';
import { createLogger } from '../../core/logger.mjs';

const log = createLogger('magicblock');

const TOKEN_MINTS_BY_NETWORK = {
  devnet: {
    SOL: new PublicKey('So11111111111111111111111111111111111111112'),
    USDC: new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'),
    USDT: new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
  },
  mainnet: {
    SOL: new PublicKey('So11111111111111111111111111111111111111112'),
    USDC: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    USDT: new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
  },
};

// Token decimals
export const TOKEN_DECIMALS = {
  SOL: 9,
  USDC: 6,
  USDT: 6,
};

function inferMagicBlockNetwork() {
  const endpoints = [
    env.MAGICBLOCK_RPC_URL,
    env.MAGICBLOCK_EPHEMERAL_URL,
  ].filter(Boolean).join(' ').toLowerCase();

  return endpoints.includes('devnet') ? 'devnet' : 'mainnet';
}

/**
 * MagicBlock Private Payments Client
 */
export class MagicBlockClient {
  constructor(keypair) {
    this.keypair = keypair;
    this.publicKey = keypair.publicKey;
    this.baseConnection = new Connection(env.MAGICBLOCK_RPC_URL, 'confirmed');
    this.ephemeralConnection = new Connection(env.MAGICBLOCK_EPHEMERAL_URL, 'confirmed');
    this.validator = DEFAULT_PRIVATE_VALIDATOR;
  }

  /**
   * Get base chain (Solana) balance for a token.
   */
  async getBaseBalance(tokenMint) {
    const mint = typeof tokenMint === 'string' ? new PublicKey(tokenMint) : tokenMint;
    const ata = getAssociatedTokenAddressSync(mint, this.publicKey, true, TOKEN_PROGRAM_ID);

    try {
      const account = await getAccount(this.baseConnection, ata);
      return account.amount;
    } catch (err) {
      if (err.name === 'TokenAccountNotFoundError') return 0n;
      throw err;
    }
  }

  /**
   * Get shielded (ephemeral rollup) balance for a token.
   */
  async getShieldedBalance(tokenMint) {
    const mint = typeof tokenMint === 'string' ? new PublicKey(tokenMint) : tokenMint;
    const [eata] = deriveEphemeralAta(this.publicKey, mint);

    try {
      // Check if delegated to ephemeral
      const baseInfo = await this.baseConnection.getAccountInfo(eata);
      if (!baseInfo) return 0n;

      // Try ephemeral connection for delegated balance
      try {
        const ata = getAssociatedTokenAddressSync(mint, this.publicKey, true, TOKEN_PROGRAM_ID);
        const account = await getAccount(this.ephemeralConnection, ata);
        return account.amount;
      } catch {
        // Fall back to base eata balance if not delegated
        const account = await getAccount(this.baseConnection, eata);
        return account.amount;
      }
    } catch (err) {
      if (err.name === 'TokenAccountNotFoundError') return 0n;
      throw err;
    }
  }

  /**
   * Deposit tokens from Solana into the ephemeral rollup (shield).
   * Uses SDK v0.10.5 delegateSpl() which handles all initialization internally.
   *
   * @param {PublicKey|string} tokenMint - Token mint address
   * @param {bigint|number} amount - Amount in smallest units (lamports, etc.)
   * @returns {Promise<string>} Transaction signature
   */
  async deposit(tokenMint, amount) {
    const mint = typeof tokenMint === 'string' ? new PublicKey(tokenMint) : tokenMint;
    const amountBn = typeof amount === 'bigint' ? amount : BigInt(amount);

    log.info({ mint: mint.toBase58(), amount: amountBn.toString() }, 'Depositing to shield');

    // SDK v0.10.5 handles all initialization internally
    const instructions = await delegateSpl(this.publicKey, mint, amountBn, {
      payer: this.publicKey,
      validator: this.validator,
      initIfMissing: true,
      initVaultIfMissing: true,
      initAtasIfMissing: true,
      private: true,
    });

    const tx = new Transaction().add(...instructions);
    const sig = await sendAndConfirmTransaction(this.baseConnection, tx, [this.keypair]);
    log.info({ sig }, 'Deposit complete');
    return sig;
  }

  /**
   * Withdraw tokens from the ephemeral rollup back to Solana (unshield).
   * Uses SDK v0.10.5 withdrawSpl() which handles undelegation internally.
   *
   * @param {PublicKey|string} tokenMint - Token mint address
   * @param {bigint|number} amount - Amount in smallest units
   * @returns {Promise<string>} Transaction signature
   */
  async withdraw(tokenMint, amount) {
    const mint = typeof tokenMint === 'string' ? new PublicKey(tokenMint) : tokenMint;
    const amountBn = typeof amount === 'bigint' ? amount : BigInt(amount);

    log.info({ mint: mint.toBase58(), amount: amountBn.toString() }, 'Withdrawing from shield');

    // SDK v0.10.5 handles undelegation internally
    const instructions = await withdrawSplIxs(this.publicKey, mint, amountBn, {
      payer: this.publicKey,
      validator: this.validator,
    });

    const tx = new Transaction().add(...instructions);
    const sig = await sendAndConfirmTransaction(this.ephemeralConnection, tx, [this.keypair]);
    log.info({ sig }, 'Withdraw complete');
    return sig;
  }

  /**
   * Transfer tokens privately within the ephemeral rollup.
   *
   * @param {PublicKey|string} tokenMint - Token mint address
   * @param {PublicKey|string} recipient - Recipient public key
   * @param {bigint|number} amount - Amount in smallest units
   * @param {number} decimals - Token decimals
   * @returns {Promise<string>} Transaction signature
   */
  async transfer(tokenMint, recipient, amount, decimals) {
    const mint = typeof tokenMint === 'string' ? new PublicKey(tokenMint) : tokenMint;
    const recipientPk = typeof recipient === 'string' ? new PublicKey(recipient) : recipient;
    const amountBn = typeof amount === 'bigint' ? amount : BigInt(amount);

    const fromAta = getAssociatedTokenAddressSync(mint, this.publicKey, true, TOKEN_PROGRAM_ID);
    const toAta = getAssociatedTokenAddressSync(mint, recipientPk, true, TOKEN_PROGRAM_ID);

    const tx = new Transaction();
    tx.add(createTransferCheckedInstruction(
      fromAta,
      mint,
      toAta,
      this.publicKey,
      amountBn,
      decimals,
    ));

    log.info({
      mint: mint.toBase58(),
      to: recipientPk.toBase58(),
      amount: amountBn.toString(),
    }, 'Private transfer');

    const sig = await sendAndConfirmTransaction(this.ephemeralConnection, tx, [this.keypair]);
    log.info({ sig }, 'Transfer complete');
    return sig;
  }

  /**
   * Compatibility wrapper used by E2E tests and agent surfaces.
   * If no recipient is supplied, transfer to self so the call still proves
   * the ephemeral execution path without fabricating a result.
   */
  async privateTransfer(tokenMint, recipientOrMint, amount, decimals) {
    const mint = typeof tokenMint === 'string' ? new PublicKey(tokenMint) : tokenMint;
    const maybeRecipient = recipientOrMint ?? this.publicKey;
    const recipientLooksLikeMint =
      maybeRecipient instanceof PublicKey &&
      maybeRecipient.equals(mint);
    const recipient = recipientLooksLikeMint ? this.publicKey : maybeRecipient;
    const resolvedDecimals = decimals ?? getTokenDecimalsByMint(mint);
    return this.transfer(mint, recipient, amount, resolvedDecimals);
  }

  /**
   * Read recent signatures observed on the ephemeral connection for the wallet.
   */
  async getTransactionHistory({ limit = 20, address } = {}) {
    const target = address
      ? (typeof address === 'string' ? new PublicKey(address) : address)
      : this.publicKey;
    const signatures = await this.ephemeralConnection.getSignaturesForAddress(target, { limit });

    return signatures.map((entry) => ({
      signature: entry.signature,
      slot: entry.slot,
      err: entry.err,
      memo: entry.memo,
      blockTime: entry.blockTime,
      confirmationStatus: entry.confirmationStatus,
    }));
  }
}

/**
 * Create a MagicBlock client from a Keypair.
 */
export function createMagicBlockClient(keypair) {
  return new MagicBlockClient(keypair);
}

/**
 * Create a MagicBlock client from a secret key (Uint8Array or base58).
 */
export function createMagicBlockClientFromSecret(secretKey) {
  const keypair = typeof secretKey === 'string'
    ? Keypair.fromSecretKey(Buffer.from(secretKey, 'base58'))
    : Keypair.fromSecretKey(secretKey);
  return new MagicBlockClient(keypair);
}

/**
 * Get token mint address by symbol.
 */
export function getTokenMint(symbol) {
  const upper = symbol.toUpperCase();
  const network = inferMagicBlockNetwork();
  return TOKEN_MINTS_BY_NETWORK[network][upper] || null;
}

/**
 * Get token decimals by symbol.
 */
export function getTokenDecimals(symbol) {
  const upper = symbol.toUpperCase();
  return TOKEN_DECIMALS[upper] || 9;
}

export function getTokenDecimalsByMint(mint) {
  const mintStr = typeof mint === 'string' ? mint : mint.toBase58();
  for (const network of Object.values(TOKEN_MINTS_BY_NETWORK)) {
    for (const [symbol, tokenMint] of Object.entries(network)) {
      if (tokenMint.toBase58() === mintStr) return TOKEN_DECIMALS[symbol] || 9;
    }
  }

  return 9;
}
