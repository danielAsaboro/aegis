/**
 * /policy — View active policies and update plan-level policy envelopes.
 */

import { listAvailablePolicies, getDefaultPolicies } from '../../policies/engine.mjs';
import {
  getDCAPlans,
  getRebalanceTargets,
  getPriceAlerts,
  getDCAPlan,
  updateDCAPlan,
  updateRebalanceTarget,
  updatePriceAlert,
} from '../../store/plans.mjs';
import { formatPolicies } from '../formatters.mjs';

export function registerPolicy(bot) {
  bot.command('policy', async (ctx) => {
    const args = (ctx.message?.text || '').split(' ').slice(1);

    if (args[0] === 'set') {
      const [_, kind, targetId, policyName, ...policyArgs] = args;
      if (!kind || !targetId || !policyName) {
        await ctx.reply(
          'Usage:\n' +
          '/policy set dca <id> spend <perTick> <daily> [total]\n' +
          '/policy set dca <id> cooldown <seconds>\n' +
          '/policy set dca <id> privacy <off|on|auto>\n' +
          '/policy set alert <id> spend <perTick> <daily> [total]\n' +
          '/policy set rebalance <id> spend <perTick> <daily> [total]'
        );
        return;
      }

      const handlers = {
        dca: async () => {
          const plan = await getDCAPlan(targetId);
          if (!plan || String(plan.chatId) !== String(ctx.chat.id)) return null;
          const policies = applyPolicyMutation(plan.policies || {}, policyName, policyArgs);
          return updateDCAPlan(targetId, { policies });
        },
        alert: async () => {
          const alert = (await getPriceAlerts(ctx.chat.id)).find((row) => row.id === targetId);
          if (!alert) return null;
          const policies = applyPolicyMutation(alert.policies || {}, policyName, policyArgs);
          return updatePriceAlert(targetId, { policies });
        },
        rebalance: async () => {
          const target = (await getRebalanceTargets(ctx.chat.id)).find((row) => row.id === targetId);
          if (!target) return null;
          const policies = applyPolicyMutation(target.policies || {}, policyName, policyArgs);
          return updateRebalanceTarget(targetId, { policies });
        },
      };

      const handler = handlers[kind];
      if (!handler) {
        await ctx.reply('Policy mutation currently supports: dca, alert, rebalance');
        return;
      }

      const updated = await handler();
      if (!updated) {
        await ctx.reply(`${kind} target ${targetId} not found`);
        return;
      }
      await ctx.replyWithMarkdown(
        `Updated policies for *${kind}* \`${targetId}\`\n\n${formatPolicies(updated.policies || {})}`
      );
      return;
    }

    const available = listAvailablePolicies();
    const lines = [
      '*Available Policies*\n',
      ...available.map(p => `• *${p.name}* (\`${p.id}\`): ${p.desc}`),
      '',
      '*Default Policies by Strategy Type*',
    ];

    for (const type of ['dca', 'dip-buyer', 'take-profit', 'rebalancer', 'group']) {
      const defaults = getDefaultPolicies(type);
      lines.push(`\n_${type}_: ${Object.keys(defaults).join(', ')}`);
    }

    // Show active plan policies
    const dcaPlans = await getDCAPlans(ctx.chat.id);
    if (dcaPlans.length > 0) {
      lines.push('\n*Active DCA Plan Policies*');
      for (const plan of dcaPlans) {
        lines.push(`\n\`${plan.id}\`:`);
        lines.push(formatPolicies(plan.policies || {}));
      }
    }

    await ctx.replyWithMarkdown(lines.join('\n'));
  });
}

export function applyPolicyMutation(existingPolicies, policyName, args) {
  const next = { ...(existingPolicies || {}) };

  if (policyName === 'spend') {
    const [perTick, daily, total] = args.map(Number);
    if (!Number.isFinite(perTick) || !Number.isFinite(daily)) {
      throw new Error('spend requires numeric <perTick> <daily> [total]');
    }
    next['spend-limit'] = {
      ...(next['spend-limit'] || {}),
      perTick,
      daily,
      ...(Number.isFinite(total) ? { total } : {}),
    };
    return next;
  }

  if (policyName === 'cooldown') {
    const seconds = Number(args[0]);
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new Error('cooldown requires a numeric number of seconds');
    }
    next.cooldown = { intervalMs: seconds * 1000 };
    return next;
  }

  if (policyName === 'privacy') {
    const mode = String(args[0] || '').toLowerCase();
    if (!['off', 'on', 'auto'].includes(mode)) {
      throw new Error('privacy mode must be one of: off, on, auto');
    }
    next.privacy = { ...(next.privacy || {}), mode };
    return next;
  }

  throw new Error(`Unsupported policy mutation: ${policyName}`);
}
