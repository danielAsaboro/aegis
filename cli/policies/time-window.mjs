#!/usr/bin/env node
/**
 * Policy: Time Window — restrict trades to a configured UTC hour range.
 *
 * Config (in policy_config):
 *   startHour:  inclusive UTC hour (0-23). Default: 0
 *   endHour:    exclusive UTC hour (1-24). Default: 24
 *   days:       optional array of allowed days-of-week (0=Sun..6=Sat). Default: all days
 *
 * A window of startHour=22, endHour=6 wraps across midnight.
 */

import { fileURLToPath } from 'node:url';

export async function check(ctx) {
  const config = ctx.policy_config || {};
  const startHour = Number.isFinite(config.startHour) ? config.startHour : 0;
  const endHour = Number.isFinite(config.endHour) ? config.endHour : 24;
  const days = Array.isArray(config.days) && config.days.length > 0 ? config.days : null;

  const now = new Date();
  const hour = now.getUTCHours();
  const day = now.getUTCDay();

  if (days && !days.includes(day)) {
    return {
      allow: false,
      reason: `Trade outside allowed days (UTC day ${day}, allowed: ${days.join(',')})`,
    };
  }

  const inWindow = startHour <= endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour;

  if (!inWindow) {
    return {
      allow: false,
      reason: `Trade outside time window (UTC ${hour}:00, allowed: ${startHour}:00-${endHour}:00)`,
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
