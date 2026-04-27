/**
 * /vote — Vote on active proposals + inline button handler.
 */

import { getActiveProposals, updateProposal, getProposal } from '../../store/plans.mjs';
import { formatProposal } from '../formatters.mjs';
import { voteKeyboard } from '../keyboards.mjs';
import bus from '../../core/event-bus.mjs';
import { SignalType } from '../../core/types.mjs';

export function registerVote(bot, config) {
  // /vote — list active proposals
  bot.command('vote', async (ctx) => {
    const proposals = getActiveProposals(ctx.chat.id);
    if (proposals.length === 0) {
      await ctx.reply('No active proposals. Create one with /propose');
      return;
    }

    for (const proposal of proposals) {
      await ctx.replyWithMarkdown(formatProposal(proposal), voteKeyboard(proposal.id));
    }
  });

  // Inline vote buttons
  bot.action(/^vote_(approve|reject)_(.+)$/, async (ctx) => {
    const action = ctx.match[1]; // 'approve' or 'reject'
    const proposalId = ctx.match[2];
    const voterId = String(ctx.from.id);
    const voterName = ctx.from.first_name || ctx.from.username || 'Unknown';

    const proposal = getProposal(proposalId);
    if (!proposal) return ctx.answerCbQuery('Proposal not found');
    if (proposal.status !== 'voting') return ctx.answerCbQuery('Voting is closed');

    // Check expiry
    if (new Date(proposal.expiresAt) < new Date()) {
      updateProposal(proposalId, { status: 'expired' });
      await ctx.answerCbQuery('Proposal has expired');
      await ctx.editMessageText(`Proposal \`${proposalId}\` — *Expired*`, { parse_mode: 'Markdown' });
      return;
    }

    // Record vote (one vote per user, last vote wins)
    const votes = { ...proposal.votes, [voterId]: action };
    updateProposal(proposalId, { votes });

    // Update message
    const updated = getProposal(proposalId);
    const approvals = Object.values(updated.votes).filter(v => v === 'approve').length;
    const rejections = Object.values(updated.votes).filter(v => v === 'reject').length;

    await ctx.answerCbQuery(`${voterName}: ${action}`);

    // Check if consensus reached
    if (approvals >= updated.requiredVotes) {
      updateProposal(proposalId, { status: 'approved' });
      await ctx.editMessageText(
        formatProposal(getProposal(proposalId)) + '\n\n✅ *CONSENSUS REACHED — Executing...*',
        { parse_mode: 'Markdown' }
      );

      // Emit CONSENSUS signal
      bus.signal(SignalType.CONSENSUS, {
        proposalId,
        approvals,
        rejections,
        voters: Object.keys(updated.votes),
        chatId: proposal.chatId,
      });
    } else {
      await ctx.editMessageText(
        formatProposal(updated),
        { parse_mode: 'Markdown', ...voteKeyboard(proposalId) }
      );
    }
  });
}
