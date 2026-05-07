#!/usr/bin/env node
/**
 * AEGIS judge-trace — single-screen policy + privacy state machine
 *
 * Designed for hackathon judges: prints every policy decision AEGIS makes
 * for a representative trade, in one screen, without touching the network
 * or moving any money. Real `runPolicies()` is invoked end-to-end against
 * the engine — the only thing not real is the proposal payload, which is
 * a representative TradeProposal shaped exactly like the ones strategies
 * produce.
 *
 * Usage:
 *   aegis judge-trace                   # full trace (default)
 *   pnpm judge-trace                    # same, via npm script
 *
 * No args, no flags. Single output. No mocks.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Route all logger output to stderr (and silence the info chatter) so the
// trace on stdout stays clean. Must run before the logger module is loaded,
// hence the dynamic imports below.
process.env.AEGIS_LOG_STDERR = '1';
process.env.LOG_LEVEL = 'silent';

const { initDb } = await import('../engine/db/index.mjs');
const {
  runPolicies,
  listAvailablePolicies,
  getDefaultPolicies,
  MissingPolicyConfigError,
} = await import('../engine/policies/engine.mjs');
const {
  check: checkPrivacy,
  getPrivacyConfig,
} = await import('../engine/policies/privacy.mjs');
const { createTradeProposal } = await import('../engine/core/types.mjs');
const { getRecentExecutions } = await import('../engine/store/executions.mjs');

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

const PASS = `${c.green}PASS${c.reset}`;
const DENY = `${c.red}DENY${c.reset}`;
const PRIV = `${c.magenta}PRIVATE${c.reset}`;
const PUB = `${c.cyan}PUBLIC${c.reset}`;

function rule(char = '─', n = 72) {
  return char.repeat(n);
}

function bar(title) {
  return `\n${c.bold}${title}${c.reset}\n${c.dim}${rule()}${c.reset}`;
}

async function main() {
  // Per-run isolated DB; never collide with the live store.
  const tempDir = mkdtempSync(join(tmpdir(), 'aegis-judge-trace-'));
  process.env.DATA_DIR = tempDir;
  process.env.AEGIS_DATABASE_URL = `file:${join(tempDir, 'aegis.db')}`;
  await initDb();

  console.log(`${c.bold}${c.cyan}AEGIS — judge trace${c.reset}`);
  console.log(`${c.dim}Single-screen proof: every policy decision, in order.${c.reset}`);
  console.log(c.dim + rule('═') + c.reset);

  // ─── 1. Registered policies ──────────────────────────────────────────────
  console.log(bar('1. Registered policies'));
  for (const p of listAvailablePolicies()) {
    console.log(`   ${c.cyan}${p.id.padEnd(13)}${c.reset} ${p.desc}`);
  }

  // ─── 2. Trade proposal #1 — passes ───────────────────────────────────────
  console.log(bar('2. Proposal #1 — DCA $5 USDC→SOL (within caps)'));

  const passProposal = createTradeProposal({
    strategyId: 'judge-trace-dca',
    strategyType: 'dca',
    fromToken: 'USDC',
    toToken: 'SOL',
    amount: 5,
    chain: 'solana',
    reason: 'judge-trace pass case',
  });

  const passConfig = {
    'spend-limit': { perTick: 10, daily: 100, total: 1000 },
    'cooldown': { intervalMs: 60_000 },
    'price-guard': { maxSlippage: 3 },
    'privacy': { mode: 'auto', thresholdUsd: 100 },
  };

  console.log(`   ${c.dim}config: ${JSON.stringify(passConfig)}${c.reset}\n`);

  const passResult = await runPolicies(passProposal, passConfig);
  for (const r of passResult.results) {
    const verdict = r.allow ? PASS : DENY;
    const extra = r.policy === 'privacy' ? ` (${r.usePrivate ? PRIV : PUB})` : '';
    const reason = r.reason ? ` — ${c.dim}${r.reason}${c.reset}` : '';
    console.log(`   ${verdict.padEnd(15)} ${c.cyan}${r.policy.padEnd(13)}${c.reset}${extra}${reason}`);
  }
  console.log(`\n   ${c.bold}Approved:${c.reset}     ${passResult.approved ? PASS : DENY}`);
  console.log(`   ${c.bold}Routing:${c.reset}      ${passResult.usePrivate ? PRIV : PUB}`);
  console.log(`   ${c.bold}Executor:${c.reset}     ${passResult.usePrivate
    ? 'engine/execution/private-executor.mjs (MagicBlock ER)'
    : 'engine/execution/executor.mjs (Zerion router)'}`);

  // ─── 3. Trade proposal #2 — denied by spend-limit ───────────────────────
  console.log(bar('3. Proposal #2 — DCA $50 USDC→SOL (exceeds $10 perTick)'));

  const denyProposal = createTradeProposal({
    strategyId: 'judge-trace-dca',
    strategyType: 'dca',
    fromToken: 'USDC',
    toToken: 'SOL',
    amount: 50,
    chain: 'solana',
    reason: 'judge-trace deny case',
  });

  const denyResult = await runPolicies(denyProposal, passConfig);
  for (const r of denyResult.results) {
    const verdict = r.allow ? PASS : DENY;
    const reason = r.reason ? ` — ${c.dim}${r.reason}${c.reset}` : '';
    console.log(`   ${verdict.padEnd(15)} ${c.cyan}${r.policy.padEnd(13)}${c.reset}${reason}`);
  }
  console.log(`\n   ${c.bold}Approved:${c.reset}     ${denyResult.approved ? PASS : DENY}`);
  console.log(`   ${c.bold}Denied by:${c.reset}    ${c.red}${denyResult.deniedBy}${c.reset}`);
  console.log(`   ${c.bold}Executor:${c.reset}     ${c.dim}never invoked — fail-closed${c.reset}`);

  // ─── 4. Trade proposal #3 — large, routes private ───────────────────────
  console.log(bar('4. Proposal #3 — DCA $200 USDC→SOL (routes private)'));

  const privProposal = createTradeProposal({
    strategyId: 'judge-trace-dca',
    strategyType: 'dca',
    fromToken: 'USDC',
    toToken: 'SOL',
    amount: 200,
    chain: 'solana',
    reason: 'judge-trace privacy case',
  });

  const privConfig = {
    'spend-limit': { perTick: 500, daily: 1000, total: 10_000 },
    'cooldown': { intervalMs: 60_000 },
    'privacy': { mode: 'auto', thresholdUsd: 100 },
  };
  console.log(`   ${c.dim}config: ${JSON.stringify(privConfig)}${c.reset}\n`);

  const privResult = await runPolicies(privProposal, privConfig);
  for (const r of privResult.results) {
    const verdict = r.allow ? PASS : DENY;
    const extra = r.policy === 'privacy' ? ` (${r.usePrivate ? PRIV : PUB})` : '';
    const reason = r.reason ? ` — ${c.dim}${r.reason}${c.reset}` : '';
    console.log(`   ${verdict.padEnd(15)} ${c.cyan}${r.policy.padEnd(13)}${c.reset}${extra}${reason}`);
  }
  console.log(`\n   ${c.bold}Approved:${c.reset}     ${privResult.approved ? PASS : DENY}`);
  console.log(`   ${c.bold}Routing:${c.reset}      ${privResult.usePrivate ? PRIV : PUB}`);
  console.log(`   ${c.bold}Executor:${c.reset}     ${privResult.usePrivate
    ? 'engine/execution/private-executor.mjs (MagicBlock ER)'
    : 'engine/execution/executor.mjs (Zerion router)'}`);

  // ─── 5. Standalone privacy router probe ─────────────────────────────────
  console.log(bar('5. Privacy router — env-driven defaults'));

  const privacyEnv = getPrivacyConfig();
  console.log(`   ${c.dim}PRIVACY_MODE       = ${privacyEnv.mode}${c.reset}`);
  console.log(`   ${c.dim}PRIVACY_THRESHOLD  = $${privacyEnv.thresholdUsd}${c.reset}`);
  console.log(`   ${c.dim}PRIVACY_TOKENS     = ${privacyEnv.privateTokens.join(', ')}${c.reset}\n`);

  // Probe with privateTokens disabled so only the threshold drives the
  // routing decision — makes the public/private split observable.
  const probes = [
    { amount: 10, label: '$10' },
    { amount: 99, label: '$99' },
    { amount: 100, label: '$100' },
    { amount: 250, label: '$250' },
  ];
  console.log(`   ${c.dim}(probe with privateTokens: [] so threshold alone drives the decision)${c.reset}`);
  for (const p of probes) {
    const r = checkPrivacy({
      transaction: { from: 'BONK', to: 'JUP', amount: p.amount },
      policy_config: {
        mode: privacyEnv.mode,
        thresholdUsd: privacyEnv.thresholdUsd,
        privateTokens: [],
      },
      proposal: { amount: p.amount },
    });
    console.log(`   ${p.label.padEnd(6)} → ${r.usePrivate ? PRIV : PUB}  ${c.dim}${r.reason || ''}${c.reset}`);
  }

  // ─── 6. Fail-closed proof — empty config ────────────────────────────────
  console.log(bar('6. Fail-closed proof — runPolicies({}) on the same proposal'));

  try {
    await runPolicies(passProposal, {});
    console.log(`   ${DENY} expected MissingPolicyConfigError, none thrown — ${c.red}policy gate broken${c.reset}`);
    process.exit(1);
  } catch (err) {
    if (err instanceof MissingPolicyConfigError || err.code === 'missing_policy_config') {
      console.log(`   ${PASS}  ${c.dim}MissingPolicyConfigError raised — empty policyConfig refused${c.reset}`);
      console.log(`   ${c.dim}error.code = ${err.code}${c.reset}`);
    } else {
      console.log(`   ${DENY}  unexpected error type: ${err.message}`);
      process.exit(1);
    }
  }

  // ─── 7. Defaults per strategy ───────────────────────────────────────────
  console.log(bar('7. Defaults per strategy (engine/policies/engine.mjs:getDefaultPolicies)'));
  for (const sType of ['dca', 'dip-buyer', 'rebalancer', 'group']) {
    const defaults = getDefaultPolicies(sType);
    console.log(`   ${c.cyan}${sType.padEnd(11)}${c.reset} ${JSON.stringify(defaults)}`);
  }

  // ─── 8. Most recent real trade executions (if any) ──────────────────────
  console.log(bar('8. Recent trade executions (live store)'));

  // Re-point at the user's live store for a read-only audit-tail view.
  delete process.env.DATA_DIR;
  delete process.env.AEGIS_DATABASE_URL;
  try {
    await initDb();
    const recent = await getRecentExecutions(5).catch(() => []);
    if (!recent || recent.length === 0) {
      console.log(`   ${c.dim}No prior executions in the live store.${c.reset}`);
    } else {
      for (const t of recent) {
        const status = t.success ? PASS : DENY;
        const sigShort = t.txHash ? `${t.txHash.slice(0, 12)}…` : '(no tx)';
        const route = t.private ? PRIV : PUB;
        console.log(`   ${status}  ${route}  ${t.fromToken}→${t.toToken}  ${t.amount}  ${sigShort}  ${c.dim}${t.timestamp || ''}${c.reset}`);
      }
    }
  } catch (err) {
    console.log(`   ${c.dim}Live store unavailable: ${err.message}${c.reset}`);
  }

  console.log(`\n${c.dim}${rule('═')}${c.reset}`);
  console.log(`${c.bold}End of trace.${c.reset} For the live MagicBlock signing path: ${c.cyan}pnpm demo -- --execute${c.reset}\n`);
}

await main().catch((err) => {
  console.error(`${c.red}judge-trace failed:${c.reset} ${err.message}`);
  if (process.argv.includes('--verbose')) console.error(err.stack);
  process.exit(1);
});
