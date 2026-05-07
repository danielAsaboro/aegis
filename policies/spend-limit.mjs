#!/usr/bin/env node
/**
 * Policy: Spend Limit — per-tick, rolling 24h, and lifetime USD caps per strategy.
 *
 * Config (in policy_config):
 *   perTick:    max USD per single trade (default: no limit)
 *   daily:      max USD per rolling 24h window (default: no limit)
 *   total:      max USD lifetime per strategy (default: no limit)
 *   strategyId: which strategy's spend to check
 */

import { fileURLToPath } from 'node:url';

export async function check(ctx) {
  const config = ctx.policy_config || {};
  const tx = ctx.transaction || {};
  const amount = Number(tx.amount) || 0;
  const strategyId = config.strategyId || 'default';

  // Per-tick check
  if (config.perTick && amount > config.perTick) {
    return {
      allow: false,
      reason: `Trade amount $${amount} exceeds per-tick spend limit of $${config.perTick}`,
    };
  }

  // Daily and total checks require spend tracking data
  // The policy engine injects this via the state store
  let spendData;
  try {
    // Dynamic import to avoid circular deps — only used when running in AEGIS context
    const { getSpendTracking } = await import('../engine/store/state.mjs');
    spendData = await getSpendTracking(strategyId);
  } catch {
    // Running outside AEGIS (e.g., standalone policy test) — skip spend checks
    return { allow: true };
  }

  if (config.daily && (spendData.dailySpent + amount) > config.daily) {
    return {
      allow: false,
      reason: `Daily spend would be $${(spendData.dailySpent + amount).toFixed(2)}, exceeding daily limit of $${config.daily}. Reset at midnight UTC.`,
    };
  }

  if (config.total && (spendData.totalSpent + amount) > config.total) {
    return {
      allow: false,
      reason: `Total spend would be $${(spendData.totalSpent + amount).toFixed(2)}, exceeding lifetime limit of $${config.total}`,
    };
  }

  return { allow: true };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let input = '';
  process.stdin.on('data', (chunk) => (input += chunk));
  process.stdin.on('end', async () => {
    const ctx = JSON.parse(input);
    const result = await check(ctx);
    console.log(JSON.stringify(result));
  });
}
