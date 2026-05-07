/**
 * /whale — Whale wallet tracking.
 *
 * Usage:
 *   /whale watch <address> [label]  — add wallet to watch list
 *   /whale list                     — show watched wallets
 *   /whale remove <address>         — stop watching
 */

import { addWhaleWatch, getWhaleWatches, removeWhaleWatch } from '../../store/plans.mjs';
import { formatWhaleList } from '../formatters.mjs';

export function registerWhale(bot) {
  bot.command('whale', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const subcommand = args[0];

    if (subcommand === 'watch') {
      const address = args[1];
      if (!address) {
        await ctx.reply('Usage: /whale watch <address> [label]');
        return;
      }
      const label = args.slice(2).join(' ') || '';
      await addWhaleWatch(ctx.chat.id, address, label);
      await ctx.replyWithMarkdown(`✅ Now watching \`${address.slice(0, 12)}...\` ${label}`);
      return;
    }

    if (subcommand === 'list' || !subcommand) {
      const watches = await getWhaleWatches(ctx.chat.id);
      await ctx.replyWithMarkdown('*Whale Watch List*\n\n' + formatWhaleList(watches));
      return;
    }

    if (subcommand === 'remove') {
      const address = args[1];
      if (!address) return ctx.reply('Usage: /whale remove <address>');
      const removed = await removeWhaleWatch(ctx.chat.id, address);
      await ctx.reply(removed ? 'Removed from watch list.' : 'Address not found in watch list.');
      return;
    }

    await ctx.reply('Usage: /whale [watch|list|remove]');
  });
}
