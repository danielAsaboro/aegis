#!/usr/bin/env node
/**
 * Seed the demo keypair (keys/demo.json) with devnet SOL by transferring
 * from the main SOLANA_PRIVATE_KEY wallet. One-shot. Idempotent at the
 * "do you have enough" level — re-running just adds more SOL.
 *
 * Usage:
 *   node --env-file=.env.local scripts/seed-demo-wallet.mjs [--amount=0.1]
 */

import { readFileSync } from 'node:fs';
import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';

const args = process.argv.slice(2);
const amount = (() => {
  for (const a of args) if (a.startsWith('--amount=')) return Number(a.slice(9));
  return 0.1;
})();

const mainSecret = process.env.SOLANA_PRIVATE_KEY;
if (!mainSecret) {
  console.error('SOLANA_PRIVATE_KEY missing — run with --env-file=.env.local or --env-file=.env.devnet');
  process.exit(1);
}

const main = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(mainSecret)));
const demoArr = JSON.parse(readFileSync('keys/demo.json', 'utf8'));
const demo = Keypair.fromSecretKey(Uint8Array.from(demoArr));

const conn = new Connection('https://api.devnet.solana.com', 'confirmed');

const beforeMain = await conn.getBalance(main.publicKey);
const beforeDemo = await conn.getBalance(demo.publicKey);
console.log(`main:  ${main.publicKey.toBase58()}  (${(beforeMain / LAMPORTS_PER_SOL).toFixed(4)} SOL)`);
console.log(`demo:  ${demo.publicKey.toBase58()}  (${(beforeDemo / LAMPORTS_PER_SOL).toFixed(4)} SOL)`);

if (beforeMain < amount * LAMPORTS_PER_SOL + 5_000) {
  console.error(`main wallet has insufficient SOL to transfer ${amount}`);
  process.exit(1);
}

console.log(`transferring ${amount} SOL …`);
const tx = new Transaction().add(SystemProgram.transfer({
  fromPubkey: main.publicKey,
  toPubkey: demo.publicKey,
  lamports: Math.round(amount * LAMPORTS_PER_SOL),
}));
const sig = await sendAndConfirmTransaction(conn, tx, [main]);

const afterDemo = await conn.getBalance(demo.publicKey);
console.log(`signature: ${sig}`);
console.log(`explorer:  https://explorer.solana.com/tx/${sig}?cluster=devnet`);
console.log(`demo balance now: ${(afterDemo / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
