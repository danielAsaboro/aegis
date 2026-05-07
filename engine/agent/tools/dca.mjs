/**
 * DCA tools — create / list / pause / cancel scheduled buys.
 *
 * createDCAPlan is value-moving (delegates ongoing buys to AEGIS), so it's
 * gated by `needsApproval: true`. Listing / pause / cancel are read or
 * state-only and do not require approval.
 */

import { tool } from 'ai';
import { z } from 'zod';
import {
  addDCAPlan,
  getDCAPlans,
  getDCAPlan,
  updateDCAPlan,
} from '../../store/plans.mjs';
import { syncJobs as syncDCAJobs } from '../../monitors/scheduler.mjs';
import { createDCAPlan as createDCAPlanRecord } from '../../core/types.mjs';
import { getDefaultPolicies } from '../../policies/engine.mjs';
import { needsApprovalGate } from './_approval-gate.mjs';
import env from '../../config.mjs';

function chatIdFromContext(ctx) {
  return ctx?.experimental_context?.chatId || ctx?.experimental_context?.userId || 'agent';
}

export const createDCAPlan = tool({
  description: 'Create a new DCA (dollar-cost-average) plan. The scheduler will fire on the cron schedule and route each tick through the policy engine before executing. Specify amount in source-token units (typically USDC).',
  inputSchema: z.object({
    fromToken: z.string().optional().describe('Source token (default: USDC).'),
    toToken: z.string().describe('Token to accumulate (e.g. SOL, ETH).'),
    amount: z.string().describe('Amount per tick in source-token units, as a string.'),
    chain: z.string().optional().describe('Chain. Default: env DEFAULT_CHAIN.'),
    cron: z.string().describe('Cron expression. e.g. "0 */6 * * *" = every 6h, "0 12 * * *" = daily noon UTC.'),
    forcePrivate: z.boolean().optional().describe('Force MagicBlock private execution for every tick.'),
  }),
  needsApproval: needsApprovalGate({ kind: 'dca' }),
  execute: async ({ fromToken, toToken, amount, chain, cron, forcePrivate }, ctx) => {
    const plan = createDCAPlanRecord({
      fromToken: fromToken || 'USDC',
      toToken: toToken.toUpperCase(),
      amount,
      chain: chain || env.DEFAULT_CHAIN,
      cron,
      policies: getDefaultPolicies('dca'),
      chatId: chatIdFromContext(ctx),
      forcePrivate: !!forcePrivate,
    });

    await addDCAPlan(plan);
    await syncDCAJobs();

    return {
      success: true,
      planId: plan.id,
      cron: plan.cron,
      from: plan.fromToken,
      to: plan.toToken,
      amount: plan.amount,
      chain: plan.chain,
      forcePrivate: plan.forcePrivate,
      status: plan.status,
    };
  },
});

export const listDCAPlans = tool({
  description: 'List DCA plans for the current chat (or all if chatId is unavailable).',
  inputSchema: z.object({
    onlyActive: z.boolean().optional(),
  }),
  execute: async ({ onlyActive }, ctx) => {
    const chatId = chatIdFromContext(ctx);
    let plans = await getDCAPlans(chatId);
    if (onlyActive) plans = plans.filter(p => p.status === 'active');
    return { count: plans.length, plans };
  },
});

export const pauseDCAPlan = tool({
  description: 'Pause an active DCA plan by id. The scheduler stops firing ticks until it is resumed (manually).',
  inputSchema: z.object({
    planId: z.string(),
  }),
  execute: async ({ planId }) => {
    const plan = await getDCAPlan(planId);
    if (!plan) throw new Error(`No DCA plan with id ${planId}.`);
    const updated = await updateDCAPlan(planId, { status: 'paused' });
    await syncDCAJobs();
    return { success: true, planId, status: updated.status };
  },
});

export const cancelDCAPlan = tool({
  description: 'Cancel a DCA plan permanently.',
  inputSchema: z.object({
    planId: z.string(),
  }),
  execute: async ({ planId }) => {
    const plan = await getDCAPlan(planId);
    if (!plan) throw new Error(`No DCA plan with id ${planId}.`);
    const updated = await updateDCAPlan(planId, { status: 'cancelled' });
    await syncDCAJobs();
    return { success: true, planId, status: updated.status };
  },
});
