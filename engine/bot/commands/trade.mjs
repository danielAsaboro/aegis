/**
 * /trade — Manual one-off swap via Zerion.
 *
 * Usage: /trade <from> <to> <amount> [chain] [--private]
 * Example: /trade USDC SOL 5 solana
 * Example: /trade USDC SOL 5 --private  (uses MagicBlock private execution)
 */

import { executeTrade, getTxExplorerUrl } from '../../execution/executor.mjs';
import { runPolicies, getDefaultPolicies } from '../../policies/engine.mjs';
import { createTradeProposal } from '../../core/types.mjs';
import { formatExecution, formatDenied } from '../formatters.mjs';
import { confirmTradeKeyboard } from '../keyboards.mjs';

const _pendingTrades = new Map();

/**
 * Parse trade command arguments, extracting --private flag.
 */
function parseTradeArgs(args) {
  const isPrivate = args.includes('--private') || args.includes('-p');
  const filtered = args.filter(a => a !== '--private' && a !== '-p');
  return { args: filtered, isPrivate };
}

export function registerTrade(bot, config) {
  bot.command('trade', async (ctx) => {
    const rawArgs = ctx.message.text.split(' ').slice(1);
    const { args, isPrivate } = parseTradeArgs(rawArgs);

    if (args.length < 3) {
      await ctx.reply(
        'Usage: /trade <from> <to> <amount> [chain] [--private]\n' +
        'Example: /trade USDC SOL 5 solana\n' +
        'Example: /trade USDC SOL 5 --private (MagicBlock private execution)'
      );
      return;
    }

    const [fromToken, toToken, amount, chain] = args;
    const tradeChain = chain || config.defaultChain;

    const proposal = createTradeProposal({
      strategyId: `manual-${ctx.from.id}`,
      strategyType: 'manual',
      fromToken: fromToken.toUpperCase(),
      toToken: toToken.toUpperCase(),
      amount,
      chain: tradeChain,
      reason: isPrivate ? 'Manual private trade via Telegram' : 'Manual trade via Telegram',
      signal: { type: 'MANUAL', userId: ctx.from.id },
      policies: getDefaultPolicies('dca'),
      forcePrivate: isPrivate,
    });

    // Store and ask for confirmation
    _pendingTrades.set(proposal.id, { proposal, chatId: ctx.chat.id, isPrivate });

    const privacyBadge = isPrivate ? ' 🔒 PRIVATE' : '';
    await ctx.replyWithMarkdown(
      `*Confirm Trade*${privacyBadge}\n${amount} ${fromToken.toUpperCase()} → ${toToken.toUpperCase()} on ${tradeChain}`,
      confirmTradeKeyboard(proposal.id)
    );
  });

  bot.action(/^trade_confirm_(.+)$/, async (ctx) => {
    const tradeId = ctx.match[1];
    const pending = _pendingTrades.get(tradeId);
    if (!pending) return ctx.answerCbQuery('Trade expired');

    _pendingTrades.delete(tradeId);
    await ctx.answerCbQuery('Executing...');

    const execMsg = pending.isPrivate ? '⏳ Executing private trade...' : '⏳ Executing trade...';
    await ctx.editMessageText(execMsg);

    // Run policies first
    const policyResult = await runPolicies(pending.proposal, pending.proposal.policies);
    if (!policyResult.approved) {
      await ctx.editMessageText(
        formatDenied(pending.proposal, policyResult.deniedBy, policyResult.reason),
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Execute with privacy flag
    const result = await executeTrade(pending.proposal, {
      walletName: config.walletName,
      usePrivate: pending.isPrivate || policyResult.usePrivate,
    });
    await ctx.editMessageText(formatExecution(result), { parse_mode: 'Markdown' });
  });

  bot.action(/^trade_cancel_(.+)$/, async (ctx) => {
    _pendingTrades.delete(ctx.match[1]);
    await ctx.answerCbQuery('Cancelled');
    await ctx.editMessageText('Trade cancelled.');
  });
}
