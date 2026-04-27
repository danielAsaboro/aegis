#!/usr/bin/env node
/**
 * Policy: Cooldown — enforce minimum interval between trades per strategy.
 *
 * Config (in policy_config):
 *   intervalMs:  minimum milliseconds between trades (default: 60000)
 *   strategyId:  which strategy's cooldown to check
 */

import { fileURLToPath } from 'node:url';

export async function check(ctx) {
  const config = ctx.policy_config || {};
  const intervalMs = config.intervalMs ?? 60_000;
  const strategyId = config.strategyId || 'default';

  // Check cooldown via state store
  try {
    const { isOnCooldown, getCooldownRemaining } = await import('../engine/store/state.mjs');
    if (isOnCooldown(strategyId)) {
      const remaining = getCooldownRemaining(strategyId);
      const remainingSec = Math.ceil(remaining / 1000);
      return {
        allow: false,
        reason: `Strategy on cooldown. ${remainingSec}s remaining (min interval: ${intervalMs / 1000}s)`,
      };
    }
  } catch {
    // Running outside AEGIS context — no cooldown tracking
    return { allow: true };
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
