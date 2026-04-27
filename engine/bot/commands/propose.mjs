/**
 * /propose — Submit a trade for group vote.
 *
 * Usage: /propose <from> <to> <amount> [chain]
 * Example: /propose USDC SOL 20 solana
 */

import { createGroupProposal } from '../../core/types.mjs';
import { addProposal } from '../../store/plans.mjs';
import { formatProposal } from '../formatters.mjs';
import { voteKeyboard } from '../keyboards.mjs';

export function registerPropose(bot, config) {
  bot.command('propose', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);

    if (args.length < 3) {
      await ctx.reply('Usage: /propose <from> <to> <amount> [chain]\nExample: /propose USDC SOL 20 solana');
      return;
    }

    const [fromToken, toToken, amount, chain] = args;

    const proposal = createGroupProposal({
      fromToken: fromToken.toUpperCase(),
      toToken: toToken.toUpperCase(),
      amount,
      chain: chain || config.defaultChain,
      proposerId: ctx.from.id,
      proposerName: ctx.from.first_name || ctx.from.username || 'Unknown',
      chatId: ctx.chat.id,
      requiredVotes: config.requiredVotes || 3,
    });

    addProposal(proposal);

    await ctx.replyWithMarkdown(
      formatProposal(proposal),
      voteKeyboard(proposal.id)
    );
  });
}
