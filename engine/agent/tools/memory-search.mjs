/**
 * Semantic memory tools — local-first vector search over the user's
 * AgentFact rows and historical AgentToolCall rows, powered by QVAC
 * embeddings.
 *
 * `searchFacts` and `searchTradeHistory` are the only RAG tools that hit
 * the embedding model. `summarizeSimilarTrades` chains a search call into
 * an LLM synthesis step — the only place the cloud LLM still touches
 * memory contents in the QVAC RAG path; retrieval itself stays on-device.
 *
 * Brute-force k-NN: load all candidate vectors for this user, score in
 * JS, return top-K. Per-user N is small at hackathon scale; a sqlite-vss
 * upgrade is a future drop-in.
 */

import { tool } from 'ai';
import { z } from 'zod';
import env from '../../config.mjs';
import { getPrisma } from '../../db/index.mjs';
import { getEmbedder, QvacUnavailableError } from '../../qvac/index.mjs';
import { bytesToVector, cosine } from '../../qvac/embeddings.mjs';

function userIdFromCtx(ctx) {
  const id = ctx?.experimental_context?.userId;
  if (!id) {
    throw new Error('memory-search tool: userId missing from experimental_context.');
  }
  return String(id);
}

async function embedQuery(text) {
  if (!env.QVAC_ENABLE_RAG) {
    return { ok: false, reason: 'rag_disabled' };
  }
  try {
    const e = await getEmbedder();
    const vec = await e.embed(text);
    return { ok: true, vec, dim: vec.length };
  } catch (err) {
    if (err instanceof QvacUnavailableError) {
      return { ok: false, reason: err.reason };
    }
    return { ok: false, reason: err.message || String(err) };
  }
}

function rank(vec, candidates) {
  const out = [];
  for (const c of candidates) {
    if (c.dim !== vec.length) continue;
    const candVec = bytesToVector(c.vector);
    const score = cosine(vec, candVec);
    out.push({ ...c, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

export const searchFacts = tool({
  description: 'Semantic search over the user\'s remembered facts (preferences, sizes, watchlists). Use this when the user phrases a question fuzzily ("what was that thing about stables?") instead of a specific key. Falls back to recallFacts if QVAC embeddings are unavailable.',
  inputSchema: z.object({
    query: z.string().min(1).describe('Natural-language search query.'),
    topK: z.number().int().positive().max(20).optional().describe('Max results (default 5).'),
  }),
  execute: async ({ query, topK }, ctx) => {
    const userId = userIdFromCtx(ctx);
    const k = Math.min(topK || 5, 20);

    const embedded = await embedQuery(query);
    if (!embedded.ok) {
      return {
        success: false,
        ragAvailable: false,
        reason: embedded.reason,
        suggestion: 'Try recallFacts(query) — substring match still works without QVAC.',
        results: [],
      };
    }

    const rows = await getPrisma().agentFactEmbedding.findMany({
      where: { fact: { userId } },
      include: { fact: true },
      take: 500,
    });

    const ranked = rank(embedded.vec, rows).slice(0, k);

    return {
      success: true,
      ragAvailable: true,
      query,
      results: ranked.map(r => ({
        score: Number(r.score.toFixed(4)),
        key: r.fact.key,
        value: r.fact.value,
        category: r.fact.category,
        updatedAt: r.fact.updatedAt,
      })),
    };
  },
});

export const searchTradeHistory = tool({
  description: 'Semantic search over the user\'s past state-mutating tool calls (swaps, DCA plans, shield deposits/withdraws). Use when the user references prior trades fuzzily ("like last Tuesday", "the one that got denied"). Returns ranked summaries with timestamps and tx hashes when present.',
  inputSchema: z.object({
    query: z.string().min(1),
    topK: z.number().int().positive().max(20).optional(),
    onlySuccessful: z.boolean().optional().describe('If true, only include success=true tool calls.'),
  }),
  execute: async ({ query, topK, onlySuccessful }, ctx) => {
    const userId = userIdFromCtx(ctx);
    const k = Math.min(topK || 5, 20);

    const embedded = await embedQuery(query);
    if (!embedded.ok) {
      return {
        success: false,
        ragAvailable: false,
        reason: embedded.reason,
        suggestion: 'Try getHistory() for raw chronological listing.',
        results: [],
      };
    }

    const where = { userId };
    if (onlySuccessful) {
      where.toolCall = { success: true };
    }
    const rows = await getPrisma().agentToolCallEmbedding.findMany({
      where,
      include: { toolCall: true },
      take: 1000,
    });

    const ranked = rank(embedded.vec, rows).slice(0, k);

    return {
      success: true,
      ragAvailable: true,
      query,
      results: ranked.map(r => ({
        score: Number(r.score.toFixed(4)),
        toolCallId: r.toolCallId,
        toolName: r.toolCall.toolName,
        summary: r.summary,
        success: r.toolCall.success,
        createdAt: r.toolCall.createdAt,
      })),
    };
  },
});

export const summarizeSimilarTrades = tool({
  description: 'Find past trades semantically similar to the user\'s current intent and return a brief pattern summary the model can lean on. Combines local retrieval (QVAC) with the active LLM for synthesis. The retrieval step never leaves the device.',
  inputSchema: z.object({
    query: z.string().min(1).describe('Description of the intent or trade you want to find precedents for.'),
    topK: z.number().int().positive().max(15).optional(),
  }),
  execute: async ({ query, topK }, ctx) => {
    const userId = userIdFromCtx(ctx);
    const k = Math.min(topK || 8, 15);

    const embedded = await embedQuery(query);
    if (!embedded.ok) {
      return {
        success: false,
        ragAvailable: false,
        reason: embedded.reason,
        results: [],
        summary: null,
      };
    }

    const rows = await getPrisma().agentToolCallEmbedding.findMany({
      where: { userId },
      include: { toolCall: true },
      take: 1000,
    });
    const ranked = rank(embedded.vec, rows).slice(0, k);
    if (ranked.length === 0) {
      return {
        success: true,
        ragAvailable: true,
        results: [],
        summary: 'No past trades found for this user.',
      };
    }

    // Compute simple statistics — these are deterministic, model-free.
    const byTool = {};
    const successCount = ranked.filter(r => r.toolCall.success).length;
    let firstAt = null, lastAt = null;
    for (const r of ranked) {
      byTool[r.toolCall.toolName] = (byTool[r.toolCall.toolName] || 0) + 1;
      const t = r.toolCall.createdAt instanceof Date ? r.toolCall.createdAt : new Date(r.toolCall.createdAt);
      if (!firstAt || t < firstAt) firstAt = t;
      if (!lastAt || t > lastAt) lastAt = t;
    }

    const summary = [
      `Found ${ranked.length} similar past tool calls (${successCount} successful, ${ranked.length - successCount} failed/denied).`,
      `Tools used: ${Object.entries(byTool).map(([k, v]) => `${k}×${v}`).join(', ')}.`,
      firstAt && lastAt
        ? `Time range: ${firstAt.toISOString().slice(0, 10)} → ${lastAt.toISOString().slice(0, 10)}.`
        : null,
    ].filter(Boolean).join(' ');

    return {
      success: true,
      ragAvailable: true,
      query,
      summary,
      results: ranked.map(r => ({
        score: Number(r.score.toFixed(4)),
        toolName: r.toolCall.toolName,
        summary: r.summary,
        success: r.toolCall.success,
        createdAt: r.toolCall.createdAt,
      })),
    };
  },
});
