/**
 * /policy — View active policies and available policies.
 */

import { listAvailablePolicies, getDefaultPolicies } from '../../policies/engine.mjs';
import { getDCAPlans, getActiveRebalanceTargets, getActivePriceAlerts } from '../../store/plans.mjs';
import { formatPolicies } from '../formatters.mjs';

export function registerPolicy(bot) {
  bot.command('policy', async (ctx) => {
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
    const dcaPlans = getDCAPlans(ctx.chat.id);
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
