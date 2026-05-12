/**
 * Mission tools — let the agent commit, list, pause, cancel, and inspect
 * Missions. commitMission is the single approval the user gives for an
 * autonomous envelope; everything inside that envelope (per-tx ≤ cap,
 * within policy bundle) auto-approves through the gate.
 *
 * commitMission is itself approval-gated: the operator-facing surface still asks
 * the user "are you sure?" before the agent commits a Mission. That's
 * the *only* approval for the entire mission lifetime — every tick
 * inside the envelope auto-approves through `_approval-gate.mjs`.
 */

import { tool } from 'ai';
import { z } from 'zod';
import {
  commitMission as commitMissionImpl,
  pauseMission as pauseMissionImpl,
  resumeMission as resumeMissionImpl,
  cancelMission as cancelMissionImpl,
  listMissions as listMissionsImpl,
  getMission as getMissionImpl,
  getMissionEvents,
  VALID_KINDS,
} from '../../missions/index.mjs';
import { getDefaultPolicies } from '../../policies/engine.mjs';
import { addDCAPlan } from '../../store/plans.mjs';
import { syncJobs as syncDCAJobs } from '../../monitors/scheduler.mjs';
import { createDCAPlan as createDCAPlanRecord } from '../../core/types.mjs';
import { notify } from '../../notify/index.mjs';
import env from '../../config.mjs';

function userIdFromCtx(ctx) {
  return ctx?.experimental_context?.userId || 'agent';
}

function chatIdFromCtx(ctx) {
  return ctx?.experimental_context?.chatId || ctx?.experimental_context?.userId || null;
}

const policiesSchema = z.record(z.string(), z.any())
  .describe('Policy envelope — keys: spend-limit, time-window, price-guard, cooldown, allowlist, deny-approvals, deny-transfers, consensus, privacy. Each value is the policy-specific config (see listAvailablePolicies).');

export const commitMission = tool({
  description: 'Commit an autonomous mission. The user authorizes the policy envelope (limits, time windows, price caps, cooldowns) plus a budget and per-tx cap; the agent then runs autonomously within that envelope until budget is exhausted, time expires, or the user pauses/cancels. This is the ONE approval the user gives — every trade inside the envelope auto-approves through the policy gate.',
  inputSchema: z.object({
    title: z.string().describe('Short label, e.g. "DCA SOL hourly".'),
    intent: z.string().describe('Natural-language summary of what the mission does (preserved for audit).'),
    kind: z.enum(['dca', 'dip', 'rebalance', 'group', 'agent']).describe('Mission kind — selects which strategy machinery handles ticks.'),
    policies: policiesSchema,
    budgetUsd: z.number().positive().optional().describe('Total USD the mission may spend before exhausting.'),
    perTxCapUsd: z.number().positive().describe('Per-tx auto-approval cap in USD. Trades within this cap auto-approve; trades above prompt the user.'),
    expiresAt: z.string().datetime().optional().describe('ISO 8601 expiry. Mission is auto-marked expired after this time.'),
    config: z.object({
      fromToken: z.string().optional(),
      toToken: z.string().optional(),
      amount: z.string().optional(),
      chain: z.string().optional(),
      cron: z.string().optional(),
      forcePrivate: z.boolean().optional(),
    }).optional().describe('Strategy-specific config. For kind=dca, requires fromToken/toToken/amount/chain/cron.'),
  }),
  needsApproval: true,
  execute: async ({ title, intent, kind, policies, budgetUsd, perTxCapUsd, expiresAt, config }, ctx) => {
    const userId = userIdFromCtx(ctx);
    const chatId = chatIdFromCtx(ctx);

    let dcaPlanId = null;
    if (kind === 'dca') {
      const cfg = config || {};
      if (!cfg.toToken || !cfg.amount || !cfg.cron) {
        throw new Error('Mission kind=dca requires config.toToken, config.amount, config.cron.');
      }
      const plan = createDCAPlanRecord({
        fromToken: cfg.fromToken || 'USDC',
        toToken: String(cfg.toToken).toUpperCase(),
        amount: String(cfg.amount),
        chain: cfg.chain || env.DEFAULT_CHAIN,
        cron: cfg.cron,
        policies,
        chatId,
        forcePrivate: !!cfg.forcePrivate,
      });
      await addDCAPlan(plan);
      await syncDCAJobs();
      dcaPlanId = plan.id;
    }

    const mission = await commitMissionImpl({
      userId,
      chatId,
      title,
      intent,
      kind,
      policies,
      budgetUsd,
      perTxCapUsd,
      expiresAt,
      dcaPlanId,
    });

    try {
      await notify({
        level: 'info',
        title: `Mission committed: ${title}`,
        body: `${intent}${budgetUsd ? ` (budget $${budgetUsd}, cap $${perTxCapUsd})` : ` (cap $${perTxCapUsd})`}`,
        missionId: mission.id,
      });
    } catch { /* non-fatal */ }

    return {
      success: true,
      missionId: mission.id,
      title: mission.title,
      kind: mission.kind,
      status: mission.status,
      budgetUsd: mission.budgetUsd,
      perTxCapUsd: mission.perTxCapUsd,
      expiresAt: mission.expiresAt,
      dcaPlanId: mission.dcaPlanId,
    };
  },
});

export const listMissions = tool({
  description: 'List missions for the current user. Optionally filter by status.',
  inputSchema: z.object({
    status: z.enum(['active', 'paused', 'done', 'cancelled', 'exhausted', 'expired']).optional(),
  }),
  execute: async ({ status }, ctx) => {
    const userId = userIdFromCtx(ctx);
    const missions = await listMissionsImpl({ userId, status });
    return {
      count: missions.length,
      missions: missions.map((m) => ({
        id: m.id,
        title: m.title,
        kind: m.kind,
        status: m.status,
        budgetUsd: m.budgetUsd,
        spentUsd: m.spentUsd,
        perTxCapUsd: m.perTxCapUsd,
        expiresAt: m.expiresAt,
        createdAt: m.createdAt,
      })),
    };
  },
});

export const getMissionStatus = tool({
  description: 'Inspect a specific mission — current spend, status, recent events.',
  inputSchema: z.object({
    missionId: z.string(),
  }),
  execute: async ({ missionId }) => {
    const mission = await getMissionImpl(missionId);
    if (!mission) return { success: false, reason: 'not_found' };
    const events = await getMissionEvents(missionId, { limit: 20 });
    return {
      success: true,
      mission: {
        id: mission.id,
        title: mission.title,
        kind: mission.kind,
        status: mission.status,
        intent: mission.intent,
        budgetUsd: mission.budgetUsd,
        spentUsd: mission.spentUsd,
        perTxCapUsd: mission.perTxCapUsd,
        expiresAt: mission.expiresAt,
        policies: mission.policies,
      },
      events,
    };
  },
});

export const pauseMission = tool({
  description: 'Pause an active mission. Ticks stop firing until the mission is resumed.',
  inputSchema: z.object({
    missionId: z.string(),
    reason: z.string().optional(),
  }),
  execute: async ({ missionId, reason }) => {
    const mission = await pauseMissionImpl(missionId, reason);
    return { success: true, missionId, status: mission.status };
  },
});

export const resumeMission = tool({
  description: 'Resume a paused mission.',
  inputSchema: z.object({
    missionId: z.string(),
  }),
  execute: async ({ missionId }) => {
    const mission = await resumeMissionImpl(missionId);
    return { success: true, missionId, status: mission.status };
  },
});

export const cancelMission = tool({
  description: 'Cancel a mission permanently. Does not unwind past trades.',
  inputSchema: z.object({
    missionId: z.string(),
    reason: z.string().optional(),
  }),
  execute: async ({ missionId, reason }) => {
    const mission = await cancelMissionImpl(missionId, reason);
    return { success: true, missionId, status: mission.status };
  },
});
