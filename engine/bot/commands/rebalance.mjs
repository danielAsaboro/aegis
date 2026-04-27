/**
 * /rebalance — Set target portfolio allocations and view drift.
 *
 * Usage:
 *   /rebalance set SOL:50 ETH:30 USDC:20  — set targets
 *   /rebalance status                      — show current vs target
 */

import { createRebalanceTarget } from '../../core/types.mjs';
import { setRebalanceTarget, getRebalanceTargets } from '../../store/plans.mjs';
import { getPortfolioAllocations } from '../../utils/zerion-api.mjs';
import { getEvmAddress, getSolAddress } from '../../../cli/lib/wallet/keystore.js';
import { isSolana } from '../../../cli/lib/chain/registry.js';
import { getDefaultPolicies } from '../../policies/engine.mjs';
import { formatRebalanceStatus } from '../formatters.mjs';

export function registerRebalance(bot, config) {
  bot.command('rebalance', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const subcommand = args[0];

    if (subcommand === 'set') {
      // Parse targets: SOL:50 ETH:30 USDC:20
      const targetArgs = args.slice(1);
      if (targetArgs.length === 0) {
        await ctx.reply('Usage: /rebalance set SOL:50 ETH:30 USDC:20\n\nWeights must sum to 100.');
        return;
      }

      const targets = [];
      let totalWeight = 0;
      for (const arg of targetArgs) {
        const [token, weight] = arg.split(':');
        if (!token || !weight || isNaN(Number(weight))) {
          await ctx.reply(`Invalid target: ${arg}. Use TOKEN:WEIGHT format.`);
          return;
        }
        targets.push({ token: token.toUpperCase(), weight: Number(weight) });
        totalWeight += Number(weight);
      }

      if (Math.abs(totalWeight - 100) > 1) {
        await ctx.reply(`Weights sum to ${totalWeight}%, must be 100%.`);
        return;
      }

      const chain = args.find(a => !a.includes(':')) || config.defaultChain;
      const target = createRebalanceTarget({
        chatId: ctx.chat.id,
        chain,
        targets,
        threshold: 5,
        policies: getDefaultPolicies('rebalancer'),
      });
      setRebalanceTarget(target);
      await ctx.replyWithMarkdown(
        `✅ Rebalance target set for *${chain}*\n\n` +
        targets.map(t => `• ${t.token}: ${t.weight}%`).join('\n') +
        `\n\nDrift threshold: 5%`
      );
      return;
    }

    if (subcommand === 'status' || !subcommand) {
      const targets = getRebalanceTargets(ctx.chat.id);
      if (targets.length === 0) {
        await ctx.reply('No rebalance targets set. Use: /rebalance set SOL:50 ETH:30 USDC:20');
        return;
      }

      for (const target of targets) {
        try {
          const walletAddress = isSolana(target.chain)
            ? getSolAddress(config.walletName)
            : getEvmAddress(config.walletName);
          const positions = await getPortfolioAllocations(walletAddress, target.chain);
          await ctx.replyWithMarkdown(formatRebalanceStatus(target, positions));
        } catch (err) {
          await ctx.reply(`Error checking ${target.chain}: ${err.message}`);
        }
      }
      return;
    }

    await ctx.reply('Usage: /rebalance [set|status]');
  });
}
