#!/usr/bin/env node
/**
 * Wrap native SOL → WSOL for the keypair. MagicBlock's `delegateSpl` works
 * on SPL tokens, so the SOL we deposit into the shielded rollup must be
 * the wrapped-SOL SPL form (mint So11111111111111111111111111111111111111112).
 *
 * Steps performed (real, on-chain, no mocks):
 *   1. Compute the associated token account for WSOL.
 *   2. Create the ATA if it doesn't exist.
 *   3. Transfer the requested amount of native SOL into the ATA.
 *   4. Run `syncNative` so the SPL token balance reflects the lamport balance.
 *
 * Usage:
 *   SOLANA_PRIVATE_KEY=<bytes> node scripts/wrap-sol.mjs --amount=0.01
 *   pnpm wrap-sol -- --amount=0.01
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAccount,
  NATIVE_MINT,
} from '@solana/spl-token';

const args = process.argv.slice(2);
const amount = (() => {
  for (const a of args) if (a.startsWith('--amount=')) return Number(a.slice(9));
  return 0.01;
})();
const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

const secret = process.env.SOLANA_PRIVATE_KEY;
if (!secret) {
  console.error('SOLANA_PRIVATE_KEY missing');
  process.exit(1);
}
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)));
const conn = new Connection(rpcUrl, 'confirmed');

const ata = getAssociatedTokenAddressSync(NATIVE_MINT, kp.publicKey, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
const lamports = Math.round(amount * LAMPORTS_PER_SOL);

console.log(`pubkey:   ${kp.publicKey.toBase58()}`);
console.log(`wsol ata: ${ata.toBase58()}`);
console.log(`amount:   ${amount} SOL (${lamports} lamports)`);

const balanceBefore = await conn.getBalance(kp.publicKey);
console.log(`native bal before: ${(balanceBefore / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

const tx = new Transaction()
  .add(createAssociatedTokenAccountIdempotentInstruction(
    kp.publicKey, ata, kp.publicKey, NATIVE_MINT,
  ))
  .add(SystemProgram.transfer({
    fromPubkey: kp.publicKey,
    toPubkey: ata,
    lamports,
  }))
  .add(createSyncNativeInstruction(ata, TOKEN_PROGRAM_ID));

const sig = await sendAndConfirmTransaction(conn, tx, [kp]);
console.log(`signature: ${sig}`);
console.log(`explorer:  https://explorer.solana.com/tx/${sig}?cluster=devnet`);

try {
  const acct = await getAccount(conn, ata);
  console.log(`wsol bal after:    ${(Number(acct.amount) / LAMPORTS_PER_SOL).toFixed(6)} WSOL`);
} catch (err) {
  console.warn(`could not read ATA after wrap: ${err.message}`);
}
