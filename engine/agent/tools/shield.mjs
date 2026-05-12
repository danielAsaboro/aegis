/**
 * MagicBlock private balance tools — deposit, withdraw, balance.
 *
 * Deposit and withdraw are value-moving and require approval. Balance is
 * read-only. All three depend on a SOLANA_PRIVATE_KEY being configured;
 * if it's missing the tool returns a structured error explaining how to
 * fix it (instead of throwing, which would surface to the LLM as a
 * generic exception and could cause it to retry).
 */

import { tool } from 'ai';
import { z } from 'zod';
import {
  depositToShield as privateDeposit,
  withdrawFromShield as privateWithdraw,
  getAllShieldBalances,
} from '../../execution/private-executor.mjs';
import { recordShieldTransaction } from '../../store/shield.mjs';
import { getKeypair } from '../../lib/keypair.mjs';
import { getTokenDecimals } from '../../lib/magicblock/client.mjs';
import { needsApprovalGate } from './_approval-gate.mjs';

function loadKeypairOrError() {
  const kp = getKeypair();
  if (!kp) {
    return {
      error: true,
      reason: 'no_keypair',
      message: 'SOLANA_PRIVATE_KEY is not set in env. Set it (base58 or [u8;64] JSON) to use the MagicBlock shield.',
    };
  }
  return { keypair: kp };
}

export const getShieldBalance = tool({
  description: 'Get the active wallet\'s MagicBlock private (shielded) balances across SOL, USDC, USDT.',
  inputSchema: z.object({}),
  execute: async () => {
    const { keypair, error, message, reason } = loadKeypairOrError();
    if (error) return { success: false, reason, message };
    const balances = await getAllShieldBalances(keypair);
    const serialized = Object.fromEntries(
      Object.entries(balances).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])
    );
    return { success: true, wallet: keypair.publicKey.toBase58(), balances: serialized };
  },
});

export const depositToShield = tool({
  description: 'Move tokens from the public Solana wallet into the MagicBlock private rollup (shield). Returns tx signature on success.',
  inputSchema: z.object({
    token: z.enum(['SOL', 'USDC', 'USDT']).describe('Token symbol to deposit.'),
    amount: z.number().positive().describe('Amount in token units (e.g. 0.05 SOL, 10 USDC).'),
  }),
  needsApproval: needsApprovalGate({ kind: 'agent' }),
  execute: async ({ token, amount }) => {
    const { keypair, error, message, reason } = loadKeypairOrError();
    if (error) return { success: false, reason, message };
    const { signature, balance } = await privateDeposit(keypair, token, amount);
    const decimals = getTokenDecimals(token);
    await recordShieldTransaction({
      type: 'deposit',
      wallet: keypair.publicKey.toBase58(),
      token,
      amount: BigInt(Math.round(amount * 10 ** decimals)).toString(),
      signature,
    });
    return {
      success: true,
      signature,
      explorerUrl: `https://explorer.solana.com/tx/${signature}`,
      token,
      amount,
      newShieldedBalance: typeof balance === 'bigint' ? balance.toString() : balance,
    };
  },
});

export const withdrawFromShield = tool({
  description: 'Move tokens from the MagicBlock private rollup back to the public Solana wallet (unshield). Returns tx signature on success.',
  inputSchema: z.object({
    token: z.enum(['SOL', 'USDC', 'USDT']),
    amount: z.number().positive(),
  }),
  needsApproval: needsApprovalGate({ kind: 'agent' }),
  execute: async ({ token, amount }) => {
    const { keypair, error, message, reason } = loadKeypairOrError();
    if (error) return { success: false, reason, message };
    const { signature, balance } = await privateWithdraw(keypair, token, amount);
    const decimals = getTokenDecimals(token);
    await recordShieldTransaction({
      type: 'withdraw',
      wallet: keypair.publicKey.toBase58(),
      token,
      amount: BigInt(Math.round(amount * 10 ** decimals)).toString(),
      signature,
    });
    return {
      success: true,
      signature,
      explorerUrl: `https://explorer.solana.com/tx/${signature}`,
      token,
      amount,
      newShieldedBalance: typeof balance === 'bigint' ? balance.toString() : balance,
    };
  },
});
