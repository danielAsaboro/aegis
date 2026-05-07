/**
 * /history — Execution log with tx links.
 */

import { getRecentExecutions } from '../../store/executions.mjs';
import { formatHistory } from '../formatters.mjs';

export function registerHistory(bot) {
  bot.command('history', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const limit = parseInt(args[0]) || 10;

    const executions = await getRecentExecutions(Math.min(limit, 25));
    await ctx.replyWithMarkdown(formatHistory(executions));
  });
}
