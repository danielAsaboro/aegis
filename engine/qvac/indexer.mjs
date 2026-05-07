/**
 * QVAC indexer — embeds AgentFact / AgentToolCall rows on demand and
 * persists the vector to AgentFactEmbedding / AgentToolCallEmbedding.
 *
 * Best-effort by design: every entry point try/catches around getEmbedder()
 * so a missing model never breaks the underlying tool call. Telemetry hooks
 * call indexToolCall after a state-mutating tool runs; rememberFact calls
 * indexFact after the upsert.
 */

import env from '../config.mjs';
import { createLogger } from '../core/logger.mjs';
import bus from '../core/event-bus.mjs';
import { getPrisma } from '../db/index.mjs';
import { getEmbedder, QvacUnavailableError } from './index.mjs';
import { vectorToBytes } from './embeddings.mjs';

const log = createLogger('qvac-indexer');

// Tool calls we semantically index — only state-mutating, value-relevant
// ones. Read-only tools (getPortfolio, getTokenPrice, ...) would just
// pollute the index with noise.
const INDEXED_TOOLS = new Set([
  'executeSwap',
  'createDCAPlan',
  'pauseDCAPlan',
  'cancelDCAPlan',
  'depositToShield',
  'withdrawFromShield',
]);

export function shouldIndexTool(toolName) {
  return INDEXED_TOOLS.has(toolName);
}

function safeJSON(s) {
  if (!s || typeof s !== 'string') return null;
  try { return JSON.parse(s); } catch { return null; }
}

export function summarizeToolCall({ toolName, input, output, success, errorMsg }) {
  const inObj = typeof input === 'string' ? safeJSON(input) || { raw: input } : (input || {});
  const outObj = typeof output === 'string' ? safeJSON(output) || { raw: output } : (output || {});
  const parts = [`tool=${toolName}`, success ? 'status=success' : 'status=fail'];

  switch (toolName) {
    case 'executeSwap': {
      parts.push(`from=${inObj.fromToken || '?'}`);
      parts.push(`to=${inObj.toToken || '?'}`);
      parts.push(`amount=${inObj.amount || '?'}`);
      if (inObj.chain) parts.push(`chain=${inObj.chain}`);
      if (inObj.reason) parts.push(`reason="${String(inObj.reason).slice(0, 120)}"`);
      if (outObj.txHash) parts.push(`tx=${outObj.txHash}`);
      if (outObj.denied) parts.push(`denied_by=${outObj.deniedBy}`);
      if (outObj.estimatedOutput) parts.push(`out=${outObj.estimatedOutput}`);
      break;
    }
    case 'createDCAPlan': {
      parts.push(`from=${inObj.fromToken || 'USDC'}`);
      parts.push(`to=${inObj.toToken || '?'}`);
      parts.push(`amount=${inObj.amount || '?'}`);
      if (inObj.cron) parts.push(`cron="${inObj.cron}"`);
      break;
    }
    case 'pauseDCAPlan':
    case 'cancelDCAPlan':
      if (inObj.id) parts.push(`plan=${inObj.id}`);
      break;
    case 'depositToShield':
    case 'withdrawFromShield':
      parts.push(`token=${inObj.token || '?'}`);
      parts.push(`amount=${inObj.amount || '?'}`);
      break;
  }
  if (errorMsg) parts.push(`error="${String(errorMsg).slice(0, 160)}"`);
  return parts.join(' ');
}

async function embedOrSkip(text) {
  try {
    const e = await getEmbedder();
    const vec = await e.embed(text);
    return { vec, model: e.model || 'qvac-embed', dim: vec.length };
  } catch (err) {
    if (err instanceof QvacUnavailableError) {
      log.debug({ reason: err.reason }, 'embedder unavailable; skipping index');
      return null;
    }
    log.warn({ err: err.message }, 'embed() failed');
    return null;
  }
}

export async function indexFact(factId, text) {
  if (!env.QVAC_ENABLE_RAG) return false;
  if (!Number.isFinite(factId) || !text) return false;
  const result = await embedOrSkip(text);
  if (!result) return false;
  const { vec, model, dim } = result;
  try {
    await getPrisma().agentFactEmbedding.upsert({
      where: { factId },
      update: { model, dim, vector: vectorToBytes(vec) },
      create: { factId, model, dim, vector: vectorToBytes(vec) },
    });
    bus.emit('RAG_INDEXED', { kind: 'fact', factId, model, dim });
    return true;
  } catch (err) {
    log.warn({ err: err.message, factId }, 'indexFact persist failed');
    return false;
  }
}

export async function indexToolCall(toolCallId, summary, userId) {
  if (!env.QVAC_ENABLE_RAG) return false;
  if (!toolCallId || !summary || !userId) return false;
  const result = await embedOrSkip(summary);
  if (!result) return false;
  const { vec, model, dim } = result;
  try {
    await getPrisma().agentToolCallEmbedding.upsert({
      where: { toolCallId },
      update: { userId: String(userId), model, dim, summary, vector: vectorToBytes(vec) },
      create: { toolCallId, userId: String(userId), model, dim, summary, vector: vectorToBytes(vec) },
    });
    bus.emit('RAG_INDEXED', { kind: 'toolCall', toolCallId, model, dim });
    return true;
  } catch (err) {
    log.warn({ err: err.message, toolCallId }, 'indexToolCall persist failed');
    return false;
  }
}

/**
 * Embed every fact / tool-call missing an embedding row. Idempotent.
 * Only state-mutating tools (per INDEXED_TOOLS) are backfilled.
 */
export async function backfillAll({ batchSize = 25 } = {}) {
  if (!env.QVAC_ENABLE_RAG) {
    log.info('QVAC_ENABLE_RAG=false — skipping backfill');
    return { facts: 0, toolCalls: 0, skipped: true };
  }

  let factsIndexed = 0;
  let toolCallsIndexed = 0;
  const prisma = getPrisma();

  try {
    await getEmbedder();
  } catch (err) {
    if (err instanceof QvacUnavailableError) {
      log.warn({ reason: err.reason }, 'embedder unavailable — backfill skipped');
      return { facts: 0, toolCalls: 0, skipped: true };
    }
    throw err;
  }

  while (true) {
    const facts = await prisma.agentFact.findMany({
      where: { embedding: { is: null } },
      take: batchSize,
      orderBy: { id: 'asc' },
    });
    if (facts.length === 0) break;
    for (const f of facts) {
      const text = `${f.key} — ${f.value}`;
      const ok = await indexFact(f.id, text);
      if (ok) factsIndexed++;
    }
  }

  while (true) {
    const calls = await prisma.agentToolCall.findMany({
      where: {
        embedding: { is: null },
        toolName: { in: [...INDEXED_TOOLS] },
        success: true,
      },
      take: batchSize,
      orderBy: { createdAt: 'asc' },
    });
    if (calls.length === 0) break;
    for (const c of calls) {
      const summary = summarizeToolCall({
        toolName: c.toolName,
        input: c.input,
        output: c.output,
        success: c.success,
        errorMsg: c.errorMsg,
      });
      const ok = await indexToolCall(c.id, summary, c.userId);
      if (ok) toolCallsIndexed++;
    }
  }

  log.info({ facts: factsIndexed, toolCalls: toolCallsIndexed }, 'QVAC backfill complete');
  return { facts: factsIndexed, toolCalls: toolCallsIndexed, skipped: false };
}
