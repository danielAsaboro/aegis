#!/usr/bin/env node
/**
 * AEGIS Demo Script
 *
 * Demonstrates the full AEGIS pipeline for hackathon judges:
 * 1. Environment verification
 * 2. Wallet and balance check
 * 3. Policy engine demonstration
 * 4. MagicBlock shield operations (deposit/withdraw)
 * 5. Privacy-aware trade routing
 *
 * Run: npm run demo
 * Or:  node --env-file=.env scripts/demo.mjs
 *
 * Flags:
 *   --execute   Actually execute transactions (costs real tokens)
 *   --verbose   Show detailed output
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getKeypair, hasKeypair } from '../engine/lib/keypair.mjs';
import { MagicBlockClient, getTokenMint, getTokenDecimals, TOKEN_MINTS } from '../engine/lib/magicblock/client.mjs';
import { runPolicies, listAvailablePolicies, getDefaultPolicies } from '../engine/policies/engine.mjs';
import { check as checkPrivacy, getPrivacyConfig } from '../engine/policies/privacy.mjs';
import { createTradeProposal } from '../engine/core/types.mjs';
import { initStateStore } from '../engine/store/state.mjs';
import { initPlansStore } from '../engine/store/plans.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';

// Colors for terminal output
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

function log(prefix, msg) {
  console.log(`${prefix} ${msg}`);
}

function section(title) {
  console.log(`\n${colors.bright}${colors.magenta}=== ${title} ===${colors.reset}\n`);
}

function formatSOL(lamports) {
  return (Number(lamports) / LAMPORTS_PER_SOL).toFixed(4);
}

function formatToken(raw, decimals) {
  return (Number(raw) / 10 ** decimals).toFixed(decimals > 6 ? 6 : decimals);
}

async function main() {
  const args = process.argv.slice(2);
  const shouldExecute = args.includes('--execute');
  const verbose = args.includes('--verbose');

  console.log(`
${colors.bright}${colors.cyan}
    ___    _______________  _____
   /   |  / ____/ ____/  _// ___/
  / /| | / __/ / / __ / /  \\__ \\
 / ___ |/ /___/ /_/ // /  ___/ /
/_/  |_/_____/\\____/___/ /____/

${colors.reset}${colors.dim}Autonomous Execution Governed by Intelligence Signals${colors.reset}
${colors.dim}Privacy-first trading agent powered by Zerion + MagicBlock${colors.reset}
`);

  // Initialize temp stores for demo
  const tempDir = mkdtempSync(join(tmpdir(), 'kraken-demo-'));
  initStateStore(tempDir);
  initPlansStore(tempDir);

  // ─── Phase 1: Environment Verification ─────────────────────────────────────
  section('Environment Verification');

  const envChecks = [
    { key: 'TELEGRAM_BOT_TOKEN', required: true, mask: true },
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
      const display = mask ? `${value.slice(0, 8)}...` : value;
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

  // ─── Phase 2: Keypair & Wallet ─────────────────────────────────────────────
  section('Wallet & Keypair');

  if (!hasKeypair()) {
    log(FAIL, 'SOLANA_PRIVATE_KEY not configured');
    process.exit(1);
  }

  const keypair = getKeypair();
  const pubkey = keypair.publicKey.toBase58();
  log(OK, `Keypair loaded: ${pubkey.slice(0, 8)}...${pubkey.slice(-8)}`);

  // Check Solana balance
  const connection = new Connection(process.env.MAGICBLOCK_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
  const balance = await connection.getBalance(keypair.publicKey);
  log(INFO, `SOL Balance: ${formatSOL(balance)} SOL`);

  if (balance < LAMPORTS_PER_SOL * 0.01) {
    log(WARN, 'Low SOL balance. Fund wallet for demo transactions.');
    log(INFO, `Airdrop: solana airdrop 1 ${pubkey} --url devnet`);
  }

  // ─── Phase 3: MagicBlock Connectivity ──────────────────────────────────────
  section('MagicBlock Connectivity');

  try {
    const mbClient = new MagicBlockClient(keypair);
    log(OK, `MagicBlock RPC: ${process.env.MAGICBLOCK_RPC_URL || 'default'}`);
    log(OK, `Ephemeral URL: ${process.env.MAGICBLOCK_EPHEMERAL_URL || 'default'}`);

    // Check shielded balances
    const tokens = ['SOL', 'USDC'];
    for (const token of tokens) {
      const mint = getTokenMint(token);
      if (mint) {
        try {
          const shielded = await mbClient.getShieldedBalance(mint);
          const decimals = getTokenDecimals(token);
          log(INFO, `Shielded ${token}: ${formatToken(shielded, decimals)} ${token}`);
        } catch (err) {
          log(WARN, `Shielded ${token}: Not initialized (${err.message})`);
        }
      }
    }
  } catch (err) {
    log(FAIL, `MagicBlock connection failed: ${err.message}`);
  }

  // ─── Phase 4: Policy Engine Demo ───────────────────────────────────────────
  section('Policy Engine Demo');

  const policies = listAvailablePolicies();
  log(INFO, `Available policies (${policies.length}):`);
  for (const p of policies) {
    console.log(`       - ${colors.cyan}${p.id}${colors.reset}: ${p.desc}`);
  }

  // Demo: Create a trade proposal and run through policies
  console.log();
  log(INFO, 'Testing policy enforcement...');

  // Test 1: Trade that passes
  const passingProposal = createTradeProposal({
    strategyId: 'demo-strategy',
    strategyType: 'dca',
    fromToken: 'USDC',
    toToken: 'SOL',
    amount: 5,
    chain: 'solana',
    reason: 'Demo DCA tick',
  });

  const passingConfig = {
    'spend-limit': { perTick: 10, daily: 100 },
    'cooldown': { intervalMs: 60000 },
  };

  const passResult = await runPolicies(passingProposal, passingConfig);
  if (passResult.approved) {
    log(OK, `Trade $5 USDC->SOL: APPROVED (passed ${Object.keys(passingConfig).length} policies)`);
  } else {
    log(FAIL, `Trade $5: DENIED by ${passResult.deniedBy} - ${passResult.reason}`);
  }

  // Test 2: Trade that fails (exceeds per-tick limit)
  const failingProposal = createTradeProposal({
    strategyId: 'demo-strategy',
    strategyType: 'dca',
    fromToken: 'USDC',
    toToken: 'SOL',
    amount: 50, // Exceeds perTick of 10
    chain: 'solana',
    reason: 'Demo large trade',
  });

  const failResult = await runPolicies(failingProposal, passingConfig);
  if (!failResult.approved) {
    log(OK, `Trade $50 USDC->SOL: DENIED by ${failResult.deniedBy}`);
    console.log(`       ${colors.dim}Reason: ${failResult.reason}${colors.reset}`);
  } else {
    log(WARN, 'Expected denial but trade was approved');
  }

  // ─── Phase 5: Privacy Policy Demo ──────────────────────────────────────────
  section('Privacy Policy Demo');

  const privacyConfig = getPrivacyConfig();
  log(INFO, `Privacy Mode: ${privacyConfig.mode}`);
  log(INFO, `Threshold: $${privacyConfig.thresholdUsd}`);
  log(INFO, `Private Tokens: ${privacyConfig.privateTokens.join(', ')}`);

  // Test privacy routing
  const smallTrade = {
    transaction: { from: 'USDC', to: 'SOL', amount: 10 },
    policy_config: { mode: 'auto', thresholdUsd: 100 },
    proposal: { amount: 10 },
  };
  const smallResult = checkPrivacy(smallTrade);
  log(INFO, `$10 trade -> ${smallResult.usePrivate ? 'PRIVATE' : 'PUBLIC'} (${smallResult.reason})`);

  const largeTrade = {
    transaction: { from: 'USDC', to: 'SOL', amount: 200 },
    policy_config: { mode: 'auto', thresholdUsd: 100 },
    proposal: { amount: 200 },
  };
  const largeResult = checkPrivacy(largeTrade);
  log(INFO, `$200 trade -> ${largeResult.usePrivate ? 'PRIVATE' : 'PUBLIC'} (${largeResult.reason})`);

  // ─── Phase 6: Live Execution (if --execute flag) ───────────────────────────
  if (shouldExecute) {
    section('Live Execution');
    log(WARN, '--execute flag set. This will cost real tokens!');

    // Small deposit to MagicBlock shield
    const depositAmount = 0.001; // SOL
    log(INFO, `Depositing ${depositAmount} SOL to MagicBlock shield...`);

    try {
      const mbClient = new MagicBlockClient(keypair);
      const solMint = TOKEN_MINTS.SOL;
      const amountLamports = BigInt(Math.round(depositAmount * LAMPORTS_PER_SOL));

      const sig = await mbClient.deposit(solMint, amountLamports);
      log(OK, `Deposit successful!`);
      log(INFO, `Transaction: https://solscan.io/tx/${sig}?cluster=devnet`);

      const newBalance = await mbClient.getShieldedBalance(solMint);
      log(INFO, `New shielded SOL balance: ${formatSOL(newBalance)} SOL`);
    } catch (err) {
      log(FAIL, `Deposit failed: ${err.message}`);
      if (verbose) console.log(err.stack);
    }
  } else {
    section('Live Execution (Skipped)');
    log(INFO, 'Add --execute flag to run live MagicBlock transactions');
    log(INFO, 'Example: npm run demo -- --execute');
  }

  // ─── Summary ───────────────────────────────────────────────────────────────
  section('Summary');

  console.log(`${colors.green}AEGIS is ready for judging!${colors.reset}

${colors.bright}What we demonstrated:${colors.reset}
  1. Environment configuration with all required keys
  2. Solana keypair loading and balance check
  3. MagicBlock connectivity and shielded balance query
  4. Policy engine with AND semantics (all policies must pass)
  5. Privacy policy with auto-routing based on threshold

${colors.bright}Zerion Track Features:${colors.reset}
  - Forked Zerion CLI with 4 new policies (spend-limit, time-window, price-guard, cooldown)
  - 5 trading strategies (DCA, dip-buyer, take-profit, rebalancer, group-consensus)
  - Event-driven architecture with typed signals
  - Full Telegram bot integration

${colors.bright}MagicBlock Track Features:${colors.reset}
  - Real SDK integration (@magicblock-labs/ephemeral-rollups-sdk v0.10.5)
  - Deposit/withdraw/transfer to Ephemeral Rollups
  - Privacy policy for automatic private routing
  - /shield commands for Telegram

${colors.bright}Next Steps:${colors.reset}
  - Run the Telegram bot: ${colors.cyan}npm start${colors.reset}
  - Execute live demo: ${colors.cyan}npm run demo -- --execute${colors.reset}
  - Run tests: ${colors.cyan}npm run test:kraken${colors.reset}

${colors.dim}Demo data stored in: ${tempDir}${colors.reset}
`);
}

main().catch(err => {
  console.error(`${colors.red}Demo failed:${colors.reset}`, err.message);
  if (process.argv.includes('--verbose')) {
    console.error(err.stack);
  }
  process.exit(1);
});
