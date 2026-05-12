/**
 * Semantic-fact tools — let the agent persist user-specific knowledge
 * (preferences, recurring trade sizes, watchlist, etc.) in `AgentFact`.
 *
 * Every query is scoped to the userId from `experimental_context` so users
 * cannot read or stomp each other's facts.
 *
 * No `needsApproval`: these are scratch-space operations the agent makes on
 * its own behalf.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { getPrisma } from '../../db/index.mjs';
import { indexFact } from '../../qvac/indexer.mjs';
import { createLogger } from '../../core/logger.mjs';

const log = createLogger('facts');

const MAX_FACTS = 50;

function userIdFromCtx(ctx) {
  const id = ctx?.experimental_context?.userId;
  if (!id) {
    throw new Error('rememberFact / recallFacts: userId missing from experimental_context.');
  }
  return String(id);
}

export const rememberFact = tool({
  description: 'Persist a small durable memory for later turns. Use for user preferences, recurring sizes, watchlists, strategy intent, open issues, fixed bugs, proof constraints, and project lessons. Upserts on (userId, key). Never store private keys, seed phrases, API keys, passphrases, OTPs, or raw secrets.',
  inputSchema: z.object({
    key: z.string().min(1).describe('Stable identifier for the fact (e.g. "stable_preference", "default_dca_size", "issue_magicblock_withdraw"). Prefer updating existing keys over creating duplicates.'),
    value: z.string().min(1).describe('The fact body in concise natural language or short JSON. Redact secrets and store only the operational lesson.'),
    category: z.string().optional().describe('Optional category — "preference", "watchlist", "size", "alert", "issue", "lesson", "plan", "proof", "runtime", etc.'),
  }),
  execute: async ({ key, value, category }, ctx) => {
    const userId = userIdFromCtx(ctx);
    const row = await getPrisma().agentFact.upsert({
      where: { userId_key: { userId, key } },
      update: { value, category: category ?? null },
      create: { userId, key, value, category: category ?? null },
    });
    // Best-effort QVAC index — never block / fail the tool call on RAG.
    try {
      await indexFact(row.id, `${row.key} — ${row.value}${row.category ? ` [${row.category}]` : ''}`);
    } catch (err) {
      log.warn({ err: err.message, factId: row.id }, 'indexFact failed (non-fatal)');
    }
    return { success: true, key: row.key, value: row.value, category: row.category };
  },
});

export const recallFacts = tool({
  description: 'Retrieve previously remembered facts for this user. Use exact key/category recall for "our plan", "that issue", preferences, notes, and remembered lessons. With no query, returns the most-recent facts. Capped at 50 results.',
  inputSchema: z.object({
    query: z.string().optional().describe('Substring filter against key OR value.'),
    category: z.string().optional(),
    limit: z.number().int().positive().max(MAX_FACTS).optional(),
  }),
  execute: async ({ query, category, limit }, ctx) => {
    const userId = userIdFromCtx(ctx);
    const take = Math.min(limit ?? MAX_FACTS, MAX_FACTS);

    const where = { userId };
    if (category) where.category = category;
    if (query) {
      where.OR = [
        { key: { contains: query } },
        { value: { contains: query } },
      ];
    }

    const rows = await getPrisma().agentFact.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take,
    });
    return {
      count: rows.length,
      facts: rows.map(r => ({ key: r.key, value: r.value, category: r.category, updatedAt: r.updatedAt })),
    };
  },
});

export const forgetFact = tool({
  description: 'Delete a previously remembered fact by key. Use only when the user explicitly asks to forget something, or when replacing a stale fact with a safer canonical key.',
  inputSchema: z.object({
    key: z.string().min(1),
  }),
  execute: async ({ key }, ctx) => {
    const userId = userIdFromCtx(ctx);
    const result = await getPrisma().agentFact.deleteMany({ where: { userId, key } });
    return { success: true, deleted: result.count };
  },
});

export const listFacts = tool({
  description: 'List all remembered facts for this user. Use category filters for notes/plans/issues/lessons/proofs/preferences. Capped at 50.',
  inputSchema: z.object({
    category: z.string().optional(),
  }),
  execute: async ({ category }, ctx) => {
    const userId = userIdFromCtx(ctx);
    const where = { userId };
    if (category) where.category = category;
    const rows = await getPrisma().agentFact.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: MAX_FACTS,
    });
    return {
      count: rows.length,
      facts: rows.map(r => ({ key: r.key, value: r.value, category: r.category, updatedAt: r.updatedAt })),
    };
  },
});
