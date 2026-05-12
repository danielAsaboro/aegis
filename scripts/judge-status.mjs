#!/usr/bin/env node
/**
 * AEGIS judge-status — read-only readiness check for live evaluation.
 *
 * Default mode avoids network calls and fund movement. Pass --live to verify
 * the Zerion API key against /chains.
 */

process.env.AEGIS_LOG_STDERR = '1';
process.env.LOG_LEVEL = 'silent';

const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');
const live = args.has('--live');

const { default: env } = await import('../engine/config.mjs');
const { readFileSync } = await import('node:fs');
const { initDb } = await import('../engine/db/index.mjs');
const {
  getDefaultPolicies,
  runPolicies,
} = await import('../engine/policies/engine.mjs');
const { createTradeProposal } = await import('../engine/core/types.mjs');
const { getRecentExecutions } = await import('../engine/store/executions.mjs');
const {
  getWallet,
  listAgentTokens,
  listPolicies,
  getAgentToken,
} = await import('../cli/utils/wallet/keystore.js');
const {
  getConfigValue,
  getApiKey,
} = await import('../cli/utils/config.js');

const checks = [];

function add(id, ok, message, detail = {}) {
  checks.push({ id, ok: !!ok, message, ...detail });
}

async function safe(id, fn) {
  try {
    await fn();
  } catch (err) {
    add(id, false, err.message || String(err));
  }
}

function tokenShort(token) {
  if (!token) return null;
  if (token.length <= 12) return `${token.slice(0, 4)}...`;
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

async function probeZerionApi(apiKey) {
  const auth = `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
  const response = await fetch('https://api.zerion.io/v1/chains', {
    headers: { Accept: 'application/json', Authorization: auth },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Zerion API returned HTTP ${response.status}`);
  }
  const body = await response.json();
  if (!Array.isArray(body.data)) {
    throw new Error('Zerion API response did not include data[]');
  }
  return body.data.length;
}

await safe('api-key', async () => {
  const apiKey = getApiKey();
  add('api-key', !!apiKey, apiKey ? 'Zerion API key is configured' : 'Missing ZERION_API_KEY or config apiKey');
  if (apiKey && live) {
    const chainCount = await probeZerionApi(apiKey);
    add('zerion-live', true, `Zerion API live probe returned ${chainCount} chains`, { chainCount });
  }
});

await safe('telegram', async () => {
  add('telegram', !!env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_BOT_TOKEN
    ? 'Telegram bot token is configured'
    : 'Missing TELEGRAM_BOT_TOKEN; Telegram demo cannot launch');
});

await safe('wallet', async () => {
  const walletName = env.DEFAULT_WALLET || getConfigValue('defaultWallet') || 'main';
  const wallet = getWallet(walletName);
  add('wallet', true, `Wallet "${walletName}" exists`, {
    walletName,
    solAddress: wallet.solAddress || null,
    evmAddress: wallet.evmAddress || null,
  });
});

await safe('agent-token', async () => {
  const active = getAgentToken();
  const tokens = listAgentTokens();
  add('agent-token', !!active, active
    ? 'Active agent token is configured for unattended signing'
    : 'Missing active agent token; run zerion agent create-token or set ZERION_AGENT_TOKEN', {
      token: tokenShort(active),
      tokenCount: tokens.length,
    });
});

await safe('policies', async () => {
  const policies = listPolicies();
  const scoped = policies.filter((policy) => {
    const rules = Array.isArray(policy.rules) ? policy.rules : [];
    return rules.some((r) => r.type === 'allowed_chains')
      || rules.some((r) => r.type === 'expires_at')
      || rules.some((r) => r.type === 'deny_transfers')
      || rules.some((r) => r.type === 'deny_approvals')
      || rules.some((r) => r.type === 'allowlist');
  });
  add('policies', scoped.length > 0, scoped.length
    ? `${scoped.length} scoped Zerion/OWS polic${scoped.length === 1 ? 'y is' : 'ies are'} present`
    : 'No scoped Zerion/OWS policies found; create at least one chain/expiry/deny/allowlist policy', {
      policyIds: scoped.slice(0, 5).map((p) => p.id || p.name).filter(Boolean),
      totalPolicyCount: policies.length,
    });
});

await safe('policy-engine', async () => {
  const proposal = createTradeProposal({
    strategyId: 'judge-status',
    strategyType: 'manual',
    fromToken: 'USDC',
    toToken: 'SOL',
    amount: 5,
    chain: env.DEFAULT_CHAIN || 'solana',
    reason: 'judge-status pass probe',
  });
  const pass = await runPolicies(proposal, getDefaultPolicies('manual'));
  add('policy-engine-pass', pass.approved, pass.approved
    ? 'Policy engine approves an in-cap representative trade'
    : `Policy engine denied representative trade: ${pass.reason || pass.deniedBy}`);

  const denial = createTradeProposal({
    strategyId: 'judge-status',
    strategyType: 'manual',
    fromToken: 'USDC',
    toToken: 'SOL',
    amount: 1_000_000,
    chain: env.DEFAULT_CHAIN || 'solana',
    reason: 'judge-status denial probe',
  });
  const deny = await runPolicies(denial, getDefaultPolicies('manual'));
  add('policy-engine-deny', deny.approved === false, deny.approved === false
    ? `Policy denial works (${deny.deniedBy})`
    : 'Oversized representative trade was not denied');
});

await safe('recent-executions', async () => {
  await initDb();
  const recent = await getRecentExecutions(3).catch(() => []);
  add('recent-executions', true, recent.length
    ? `${recent.length} recent execution row(s) found in local store`
    : 'No local execution rows found; public mainnet proof should be shown from TRACKS.md', {
      recent: recent.map((row) => ({
        success: row.success,
        txHash: row.txHash || null,
        fromToken: row.fromToken,
        toToken: row.toToken,
        amount: row.amount,
        private: row.private,
      })),
    });
});

await safe('proof-artifact', async () => {
  const tracks = readFileSync(new URL('../TRACKS.md', import.meta.url), 'utf8');
  const matches = tracks.match(/https:\/\/explorer\.solana\.com\/tx\/[1-9A-HJ-NP-Za-km-z]+/g) || [];
  add('proof-artifact', matches.length > 0, matches.length
    ? `TRACKS.md contains ${matches.length} Solana Explorer proof link(s)`
    : 'TRACKS.md does not contain a Solana Explorer proof link', {
      proofs: matches.slice(0, 3),
    });
});

const failed = checks.filter((c) => !c.ok);
const payload = {
  ok: failed.length === 0,
  live,
  checkedAt: new Date().toISOString(),
  checks,
};

if (asJson) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
} else {
  process.stdout.write(`AEGIS judge status (${payload.ok ? 'READY' : 'NOT READY'})\n`);
  for (const check of checks) {
    process.stdout.write(`${check.ok ? '[PASS]' : '[FAIL]'} ${check.id}: ${check.message}\n`);
  }
  if (!live) {
    process.stdout.write('\nRun with --live to verify the Zerion API key against the network.\n');
  }
}

process.exit(payload.ok ? 0 : 1);
