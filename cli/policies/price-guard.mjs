#!/usr/bin/env node
/**
 * Policy: Price Guard — bound max slippage and optional absolute price floor/ceiling.
 *
 * Config (in policy_config):
 *   maxSlippage:    max % slippage tolerated. Default: 3
 *   minPrice:       absolute minimum acceptable execution price (per unit). Optional.
 *   maxPrice:       absolute maximum acceptable execution price (per unit). Optional.
 *
 * The executor passes the live quote in ctx.proposal.quote when available
 * (estimatedOutput, expectedOutput, slippagePct). When the quote isn't
 * present yet (pre-quote validation) the policy passes — a second pass after
 * the quote is fetched will re-check.
 */

import { fileURLToPath } from 'node:url';

export async function check(ctx) {
  const config = ctx.policy_config || {};
  const maxSlippage = Number.isFinite(config.maxSlippage) ? config.maxSlippage : 3;
  const proposal = ctx.proposal || {};
  const quote = proposal.quote || ctx.quote;

  if (!quote) {
    // Pre-quote check — defer enforcement until after a quote is fetched.
    return { allow: true };
  }

  if (Number.isFinite(quote.slippagePct) && quote.slippagePct > maxSlippage) {
    return {
      allow: false,
      reason: `Quote slippage ${quote.slippagePct.toFixed(2)}% exceeds maxSlippage ${maxSlippage}%`,
    };
  }

  const expected = Number(quote.expectedOutput);
  const minOut = Number(quote.outputMin ?? quote.estimatedOutput);
  if (Number.isFinite(expected) && Number.isFinite(minOut) && expected > 0) {
    const impliedSlip = ((expected - minOut) / expected) * 100;
    if (impliedSlip > maxSlippage) {
      return {
        allow: false,
        reason: `Implied slippage ${impliedSlip.toFixed(2)}% exceeds maxSlippage ${maxSlippage}%`,
      };
    }
  }

  if (Number.isFinite(config.minPrice) && Number.isFinite(quote.execPrice) && quote.execPrice < config.minPrice) {
    return {
      allow: false,
      reason: `Execution price ${quote.execPrice} below floor ${config.minPrice}`,
    };
  }

  if (Number.isFinite(config.maxPrice) && Number.isFinite(quote.execPrice) && quote.execPrice > config.maxPrice) {
    return {
      allow: false,
      reason: `Execution price ${quote.execPrice} above ceiling ${config.maxPrice}`,
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
