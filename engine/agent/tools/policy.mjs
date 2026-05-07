/**
 * Read-only tools that surface the policy stack to the model.
 *
 * The model needs visibility into available policies so it can explain
 * denials and suggest remediations to the user.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { listAvailablePolicies, getDefaultPolicies } from '../../policies/engine.mjs';

export const listAvailablePoliciesTool = tool({
  description: 'List all policies AEGIS supports (id, name, what they enforce). Use this to explain denials or to advise the user on which policies to attach.',
  inputSchema: z.object({}),
  execute: async () => {
    return { policies: listAvailablePolicies() };
  },
});

export const showActivePolicies = tool({
  description: 'Show the default policy config for a strategy type (manual, dca, dip-buyer, take-profit, rebalancer, group). The same defaults are attached when the agent executes a swap.',
  inputSchema: z.object({
    strategy: z.string().describe('manual | dca | dip-buyer | take-profit | rebalancer | group'),
  }),
  execute: async ({ strategy }) => {
    return { strategy, config: getDefaultPolicies(strategy) };
  },
});

export const getDefaultPoliciesForStrategy = tool({
  description: 'Alias of showActivePolicies — returns the default policy stack used by AEGIS for a given strategy type.',
  inputSchema: z.object({
    strategy: z.string(),
  }),
  execute: async ({ strategy }) => {
    return { strategy, config: getDefaultPolicies(strategy) };
  },
});
