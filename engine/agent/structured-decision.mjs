/**
 * Structured-output verdict generators for autonomous-signal decisions.
 *
 * Each helper makes a single tightly-scoped generateText call with no tools
 * and `Output.object({ schema })`. The model returns a parsed object that the
 * AgentStrategy uses to decide between (a) auto-execute under the size cap,
 * (b) advisory + approval, or (c) hold/skip.
 *
 * On any model/parse failure (NoObjectGeneratedError or otherwise), the
 * helper degrades to a hold/skip verdict with the failure reason in
 * `reason` so the strategy never crashes on a malformed response.
 */

import { generateText, Output, NoObjectGeneratedError } from 'ai';
import { z } from 'zod';
import env from '../config.mjs';
import { resolveModel } from './resolve-model.mjs';
import { createLogger } from '../core/logger.mjs';

const log = createLogger('structured-decision');

const priceMoveSchema = z.object({
  action: z.enum(['buy', 'sell', 'hold']),
  sizeUsd: z.number().positive().optional(),
  fromToken: z.string().optional(),
  toToken: z.string().optional(),
  confidence: z.enum(['low', 'medium', 'high']),
  reason: z.string().max(280),
});

const whaleMoveSchema = z.object({
  decision: z.enum(['mirror', 'fade', 'skip']),
  sizeUsd: z.number().positive().optional(),
  fromToken: z.string().optional(),
  toToken: z.string().optional(),
  confidence: z.enum(['low', 'medium', 'high']),
  reason: z.string().max(280),
});


const PRICE_SYSTEM = `You are AEGIS, an autonomous trading-signal evaluator.
You will be given a single price-move signal. Return a strict JSON object:
- action: "buy" | "sell" | "hold"
- sizeUsd (optional): conservative USD size if you choose to act
- fromToken / toToken (optional): the trade legs, symbols (e.g. "USDC", "SOL")
- confidence: "low" | "medium" | "high"
- reason: <= 280 chars rationale

Be conservative. Prefer "hold" when the signal is weak or context is thin.
Never recommend a sizeUsd above $25 from a single signal.`;

const WHALE_SYSTEM = `You are AEGIS, an autonomous whale-mirror evaluator.
You will be given a single whale-move signal. Return a strict JSON object:
- decision: "mirror" | "fade" | "skip"
- sizeUsd (optional): conservative USD size if you choose to act
- fromToken / toToken (optional): the trade legs, symbols
- confidence: "low" | "medium" | "high"
- reason: <= 280 chars rationale

Be conservative. Prefer "skip" when the signal is weak.
Never recommend a sizeUsd above $25 from a single signal.`;

function buildPriceMovePrompt(signal) {
  const direction = signal.type === 'PRICE_DIP' ? 'down' : 'up';
  const pct = signal.dropPercent ?? signal.gainPercent ?? null;
  const pctStr = typeof pct === 'number' ? pct.toFixed(2) : String(pct ?? '?');
  return [
    `Signal: ${signal.type}.`,
    `Token: ${signal.token} on ${signal.chain}.`,
    `Move: ${direction} ${pctStr}% (from ${signal.referencePrice} to ${signal.currentPrice}).`,
    `Decide: act or hold. Be conservative.`,
  ].join(' ');
}

function buildWhaleMovePrompt(signal) {
  const dir = signal.type === 'WHALE_BUY' ? 'bought' : 'sold';
  const label = signal.label ? ` (${signal.label})` : '';
  const usd = signal.usdValue ? ` (~$${signal.usdValue})` : '';
  return [
    `Signal: ${signal.type}.`,
    `Whale ${signal.address}${label} ${dir} ${signal.amount} ${signal.token} on ${signal.chain}${usd}.`,
    `Decide: mirror, fade, or skip. Be conservative.`,
  ].join(' ');
}

async function callStructured({ schema, system, prompt, fallbackHold }) {
  let model;
  try {
    model = await resolveModel(env.AEGIS_AGENT_MODEL);
  } catch (err) {
    log.warn({ err: err.message }, 'failed to resolve model for structured decision');
    return fallbackHold(`model unavailable: ${err.message}`);
  }

  try {
    const result = await generateText({
      model,
      system,
      prompt,
      output: Output.object({ schema }),
    });
    if (!result.output) {
      return fallbackHold('decision generator returned no object');
    }
    return result.output;
  } catch (err) {
    const tag = NoObjectGeneratedError.isInstance?.(err) ? 'NoObjectGeneratedError' : (err.name || 'Error');
    log.warn({ err: err.message, tag }, 'structured decision failed');
    return fallbackHold(`decision generator failed: ${err.message}`);
  }
}

export async function decideOnPriceMove(signal) {
  return callStructured({
    schema: priceMoveSchema,
    system: PRICE_SYSTEM,
    prompt: buildPriceMovePrompt(signal),
    fallbackHold: (reason) => ({ action: 'hold', confidence: 'low', reason }),
  });
}

export async function decideOnWhaleMove(signal) {
  return callStructured({
    schema: whaleMoveSchema,
    system: WHALE_SYSTEM,
    prompt: buildWhaleMovePrompt(signal),
    fallbackHold: (reason) => ({ decision: 'skip', confidence: 'low', reason }),
  });
}
