#!/usr/bin/env node
/**
 * AEGIS Demo Script — end-to-end proof of life
 *
 * Walks through every track surface in one run:
 *   Phase 1  Environment verification
 *   Phase 2  Keypair + Solana balance check
 *   Phase 3  MagicBlock connectivity (base + ephemeral) and shielded balance read
 *   Phase 4  Policy engine — real allow + real deny against runPolicies()
 *   Phase 5  Privacy router — real auto-routing decision per amount
 *   Phase 6  Live MagicBlock private flow (only with --execute):
 *              deposit  -> private transfer (optional)  -> withdraw
 *
 * Real code on every branch — no mocks, no placeholders. Phases 1–5
 * exercise the production engine; Phase 6 signs and broadcasts real
 * transactions on the network the keypair points at.
 *
 * Usage:
 *   pnpm demo                                  # phases 1–5 only, no money moves
 *   pnpm demo -- --execute                     # also run phase 6 (real tx)
 *   pnpm demo -- --execute --recipient=<pk>    # also do a private intra-ER transfer
 *   pnpm demo -- --execute --amount=0.001      # SOL amount per leg (default 0.001)
 *   pnpm demo -- --verbose                     # full stack traces on error
 */

import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getKeypair, hasKeypair } from '../engine/lib/keypair.mjs';
import {
  MagicBlockClient,
  getTokenMint,
  getTokenDecimals,
} from '../engine/lib/magicblock/client.mjs';
import {
  runPolicies,
  listAvailablePolicies,
} from '../engine/policies/engine.mjs';
import {
  check as checkPrivacy,
  getPrivacyConfig,
} from '../engine/policies/privacy.mjs';
import { createTradeProposal } from '../engine/core/types.mjs';
import { initDb } from '../engine/db/index.mjs';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

const OK = `${colors.green}[OK]${colors.reset}`;
const WARN = `${colors.yellow}[WARN]${colors.reset}`;
const FAIL = `${colors.red}[FAIL]${colors.reset}`;
const INFO = `${colors.cyan}[INFO]${colors.reset}`;

const log = (prefix, msg) => console.log(`${prefix} ${msg}`);
const section = (title) =>
  console.log(`\n${colors.bright}${colors.magenta}=== ${title} ===${colors.reset}\n`);

const formatSOL = (lamports) =>
  (Number(lamports) / LAMPORTS_PER_SOL).toFixed(6);
const formatToken = (raw, decimals) =>
  (Number(raw) / 10 ** decimals).toFixed(decimals > 6 ? 6 : decimals);

function parseArgs(argv) {
  const out = { execute: false, verbose: false, recipient: null, amountSol: 0.001 };
  for (const a of argv) {
    if (a === '--execute') out.execute = true;
    else if (a === '--verbose') out.verbose = true;
    else if (a.startsWith('--recipient=')) out.recipient = a.slice('--recipient='.length);
    else if (a.startsWith('--amount=')) out.amountSol = Number(a.slice('--amount='.length));
  }
  return out;
}

function explorerUrl(sig, cluster) {
  return cluster === 'mainnet'
    ? `https://solscan.io/tx/${sig}`
    : `https://solscan.io/tx/${sig}?cluster=devnet`;
}

function inferCluster() {
  const url = (process.env.MAGICBLOCK_RPC_URL || '').toLowerCase();
  return url.includes('devnet') || !url ? 'devnet' : 'mainnet';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const captured = []; // { label, signature, cluster }

  console.log(`
${colors.bright}${colors.cyan}
    ___    _______________  _____
   /   |  / ____/ ____/  _// ___/
  / /| | / __/ / / __ / /  \\__ \\
 / ___ |/ /___/ /_/ // /  ___/ /
/_/  |_/_____/\\____/___/ /____/

${colors.reset}${colors.dim}Autonomous Execution Governed by Intelligence Signals${colors.reset}
${colors.dim}Privacy-first trading agent — Zerion + MagicBlock + QVAC${colors.reset}
`);

  // Per-run isolated SQLite so the demo never collides with a live aegis.db.
  const tempDir = mkdtempSync(join(tmpdir(), 'aegis-demo-'));
  process.env.DATA_DIR = tempDir;
  process.env.AEGIS_DATABASE_URL = `file:${join(tempDir, 'aegis.db')}`;
  await initDb();

  // ─── Phase 1: Environment ────────────────────────────────────────────────
  section('Phase 1 — Environment Verification');

  const envChecks = [
    { key: 'TELEGRAM_BOT_TOKEN', required: false, mask: true },
    { key: 'ZERION_API_KEY', required: true, mask: true },
    { key: 'SOLANA_PRIVATE_KEY', required: true, mask: true },
    { key: 'MAGICBLOCK_RPC_URL', required: false },
    { key: 'MAGICBLOCK_EPHEMERAL_URL', required: false },
    { key: 'PRIVACY_MODE', required: false },
    { key: 'PRIVACY_THRESHOLD_USD', required: false },
  ];

  let envOk = true;
  for (const { key, required, mask } of envChecks) {
    const value = process.env[key];
    if (value) {
      const display = mask ? `${value.slice(0, 8)}…` : value;
      log(OK, `${key} = ${display}`);
    } else if (required) {
      log(FAIL, `${key} is MISSING (required)`);
      envOk = false;
    } else {
      log(WARN, `${key} not set (optional)`);
    }
  }

  if (!envOk) {
    console.log(`\n${colors.red}Missing required environment variables. Copy .env.example to .env and configure.${colors.reset}`);
    process.exit(1);
  }

  // ─── Phase 2: Keypair + balance ──────────────────────────────────────────
  section('Phase 2 — Wallet & Keypair');

  if (!hasKeypair()) {
    log(FAIL, 'SOLANA_PRIVATE_KEY not configured');
    process.exit(1);
  }

  const keypair = getKeypair();
  const pubkey = keypair.publicKey.toBase58();
  log(OK, `Keypair loaded: ${pubkey.slice(0, 8)}…${pubkey.slice(-8)}`);

  const cluster = inferCluster();
  const rpcUrl =
    process.env.MAGICBLOCK_RPC_URL ||
    (cluster === 'mainnet'
      ? 'https://api.mainnet-beta.solana.com'
      : 'https://api.devnet.solana.com');
  const connection = new Connection(rpcUrl, 'confirmed');
  const balance = await connection.getBalance(keypair.publicKey);
  log(INFO, `Cluster: ${cluster}`);
  log(INFO, `SOL balance: ${formatSOL(balance)} SOL`);

  if (balance < LAMPORTS_PER_SOL * 0.01 && args.execute) {
    log(WARN, 'Low SOL balance. --execute will likely fail at broadcast.');
    log(INFO, `Airdrop (devnet): solana airdrop 1 ${pubkey} --url devnet`);
  }

  // ─── Phase 3: MagicBlock connectivity ────────────────────────────────────
  section('Phase 3 — MagicBlock Connectivity');

  const mbClient = new MagicBlockClient(keypair);
  log(OK, `MagicBlock base RPC:      ${rpcUrl}`);
  log(OK, `MagicBlock ephemeral URL: ${process.env.MAGICBLOCK_EPHEMERAL_URL || '(unset)'}`);

  for (const symbol of ['SOL', 'USDC']) {
    const mint = getTokenMint(symbol);
    if (!mint) {
      log(WARN, `No ${symbol} mint registered for ${cluster}`);
      continue;
    }
    try {
      const shielded = await mbClient.getShieldedBalance(mint);
      const decimals = getTokenDecimals(symbol);
      log(INFO, `Shielded ${symbol}: ${formatToken(shielded, decimals)} ${symbol}`);
    } catch (err) {
      log(WARN, `Shielded ${symbol}: not yet initialized (${err.message})`);
    }
  }

  // ─── Phase 4: Policy engine ──────────────────────────────────────────────
  section('Phase 4 — Policy Engine');

  const policies = listAvailablePolicies();
  log(INFO, `Registered policies (${policies.length}):`);
  for (const p of policies) {
    console.log(`       - ${colors.cyan}${p.id}${colors.reset}: ${p.desc}`);
  }
  console.log();

  const passingProposal = createTradeProposal({
    strategyId: 'demo-strategy',
    strategyType: 'dca',
    fromToken: 'USDC',
    toToken: 'SOL',
    amount: 5,
    chain: 'solana',
    reason: 'Demo DCA tick',
  });
  const policyConfig = {
    'spend-limit': { perTick: 10, daily: 100 },
    'cooldown': { intervalMs: 60_000 },
  };

  const passResult = await runPolicies(passingProposal, policyConfig);
  if (passResult.approved) {
    log(OK, `$5 USDC→SOL: APPROVED (${Object.keys(policyConfig).length} policies)`);
  } else {
    log(FAIL, `$5 expected APPROVED, got DENIED by ${passResult.deniedBy}: ${passResult.reason}`);
  }

  const failingProposal = createTradeProposal({
    strategyId: 'demo-strategy',
    strategyType: 'dca',
    fromToken: 'USDC',
    toToken: 'SOL',
    amount: 50,
    chain: 'solana',
    reason: 'Demo over-cap trade',
  });
  const failResult = await runPolicies(failingProposal, policyConfig);
  if (!failResult.approved) {
    log(OK, `$50 USDC→SOL: DENIED by ${failResult.deniedBy}`);
    console.log(`       ${colors.dim}Reason: ${failResult.reason}${colors.reset}`);
  } else {
    log(FAIL, '$50 expected DENIED but was approved (policy engine broken)');
    process.exit(1);
  }

  // ─── Phase 5: Privacy router ─────────────────────────────────────────────
  section('Phase 5 — Privacy Router');

  const privacyConfig = getPrivacyConfig();
  log(INFO, `Privacy mode:       ${privacyConfig.mode}`);
  log(INFO, `Privacy threshold:  $${privacyConfig.thresholdUsd}`);
  log(INFO, `Privacy tokens:     ${privacyConfig.privateTokens.join(', ')}`);

  const small = checkPrivacy({
    transaction: { from: 'USDC', to: 'SOL', amount: 10 },
    policy_config: { mode: 'auto', thresholdUsd: 100 },
    proposal: { amount: 10 },
  });
  log(INFO, `$10 trade  → ${small.usePrivate ? 'PRIVATE (MagicBlock)' : 'PUBLIC (Zerion)'} — ${small.reason || 'auto'}`);

  const large = checkPrivacy({
    transaction: { from: 'USDC', to: 'SOL', amount: 200 },
    policy_config: { mode: 'auto', thresholdUsd: 100 },
    proposal: { amount: 200 },
  });
  log(INFO, `$200 trade → ${large.usePrivate ? 'PRIVATE (MagicBlock)' : 'PUBLIC (Zerion)'} — ${large.reason || 'auto'}`);

  // ─── Phase 6: Live MagicBlock private flow ───────────────────────────────
  if (!args.execute) {
    section('Phase 6 — Live MagicBlock Flow (skipped)');
    log(INFO, 'Re-run with --execute to deposit → (transfer) → withdraw on the live network');
    log(INFO, `Example: pnpm demo -- --execute --amount=0.001${args.recipient ? '' : ' [--recipient=<pk>]'}`);
  } else {
    section('Phase 6 — Live MagicBlock Flow (--execute)');
    log(WARN, `--execute enabled. Real transactions on ${cluster}.`);

    const solMint = getTokenMint('SOL');
    if (!solMint) throw new Error(`SOL mint not registered for ${cluster}`);
    const lamports = BigInt(Math.round(args.amountSol * LAMPORTS_PER_SOL));
    log(INFO, `Per-leg amount: ${args.amountSol} SOL (${lamports} lamports)`);

    // (a) Deposit
    log(INFO, 'Submitting deposit (delegateSpl with private=true)…');
    const depositSig = await mbClient.deposit(solMint, lamports);
    captured.push({ label: 'MagicBlock deposit', signature: depositSig, cluster });
    log(OK, `Deposit signature: ${depositSig}`);
    log(INFO, explorerUrl(depositSig, cluster));

    const afterDeposit = await mbClient.getShieldedBalance(solMint);
    log(INFO, `Shielded SOL after deposit: ${formatSOL(afterDeposit)} SOL`);

    // (b) Optional private intra-ER transfer
    if (args.recipient) {
      let recipientPk;
      try {
        recipientPk = new PublicKey(args.recipient);
      } catch {
        log(FAIL, `--recipient is not a valid base58 pubkey: ${args.recipient}`);
        process.exit(1);
      }
      log(INFO, `Submitting private transfer to ${args.recipient.slice(0, 8)}…${args.recipient.slice(-8)}`);
      const transferSig = await mbClient.transfer(solMint, recipientPk, lamports, 9);
      captured.push({ label: 'MagicBlock private transfer', signature: transferSig, cluster });
      log(OK, `Transfer signature: ${transferSig}`);
      log(INFO, explorerUrl(transferSig, cluster));
    } else {
      log(INFO, 'Skipping private transfer (no --recipient supplied)');
    }

    // (c) Withdraw
    log(INFO, 'Submitting withdraw (withdrawSpl)…');
    const withdrawSig = await mbClient.withdraw(solMint, lamports);
    captured.push({ label: 'MagicBlock withdraw', signature: withdrawSig, cluster });
    log(OK, `Withdraw signature: ${withdrawSig}`);
    log(INFO, explorerUrl(withdrawSig, cluster));

    const afterWithdraw = await mbClient.getShieldedBalance(solMint);
    log(INFO, `Shielded SOL after withdraw: ${formatSOL(afterWithdraw)} SOL`);
  }

  // ─── Summary ─────────────────────────────────────────────────────────────
  section('Summary');

  if (captured.length > 0) {
    console.log(`${colors.bright}Captured signatures:${colors.reset}`);
    for (const c of captured) {
      console.log(`  ${colors.green}${c.label}${colors.reset}`);
      console.log(`    ${c.signature}`);
      console.log(`    ${explorerUrl(c.signature, c.cluster)}`);
    }
    console.log();
    console.log(`${colors.dim}Paste these into TRACKS.md "Demo run — tx hashes" for the submission.${colors.reset}`);
  } else {
    console.log(
      `${colors.dim}No transactions broadcast in this run. Re-run with --execute to capture signatures.${colors.reset}`,
    );
  }

  console.log(`
${colors.bright}Surfaces:${colors.reset}
  ${colors.cyan}pnpm start${colors.reset}                  Telegram bot + monitors + strategies
  ${colors.cyan}aegis chat${colors.reset}                  CLI REPL (no bot env required)
  ${colors.cyan}aegis judge-trace${colors.reset}           Single-screen policy + privacy state machine
  ${colors.cyan}pnpm test:unit${colors.reset}              Run the 150+ unit suite
  ${colors.cyan}pnpm test:e2e:privacy${colors.reset}       Live privacy E2E (requires network + funds)

${colors.dim}Scratch DB for this run: ${tempDir}${colors.reset}
`);
}

await main().catch((err) => {
  console.error(`${colors.red}Demo failed:${colors.reset} ${err.message}`);
  if (process.argv.includes('--verbose')) {
    console.error(err.stack);
  }
  process.exit(1);
});
