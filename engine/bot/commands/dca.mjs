/**
 * /dca — Create, list, pause, resume, cancel DCA plans.
 *
 * Interactive flow with inline keyboards for plan creation.
 * Supports --private flag for MagicBlock private execution.
 */

import { createDCAPlan } from '../../core/types.mjs';
import { addDCAPlan, getDCAPlans, updateDCAPlan } from '../../store/plans.mjs';
import { syncJobs } from '../../monitors/scheduler.mjs';
import { getDefaultPolicies } from '../../policies/engine.mjs';
import { formatDCAList, formatDCAPlan } from '../formatters.mjs';
import { dcaTokenKeyboard, dcaAmountKeyboard, dcaIntervalKeyboard, dcaChainKeyboard, dcaManageKeyboard } from '../keyboards.mjs';

// In-progress DCA creation state per user
const _wizards = new Map();

/**
 * Parse DCA command arguments, extracting --private flag.
 */
function parseDCAArgs(args) {
  const isPrivate = args.includes('--private') || args.includes('-p');
  const filtered = args.filter(a => a !== '--private' && a !== '-p');
  return { args: filtered, isPrivate };
}

export function registerDCA(bot, config) {
  // /dca — show list or start creation
  bot.command('dca', async (ctx) => {
    const rawArgs = ctx.message.text.split(' ').slice(1);
    const { args, isPrivate } = parseDCAArgs(rawArgs);
    const subcommand = args[0];

    if (!subcommand || subcommand === 'list') {
      const plans = getDCAPlans(ctx.chat.id);
      let msg = formatDCAList(plans);
      if (plans.length > 0) {
        await ctx.replyWithMarkdown(msg);
        // Show manage buttons for each plan
        for (const plan of plans) {
          await ctx.reply(`Manage ${plan.id}:`, dcaManageKeyboard(plan.id));
        }
      } else {
        await ctx.replyWithMarkdown(msg);
      }
      return;
    }

    if (subcommand === 'create') {
      // Start wizard (with privacy flag stored)
      _wizards.set(ctx.from.id, {
        step: 'token',
        chatId: ctx.chat.id,
        chain: config.defaultChain,
        forcePrivate: isPrivate,
      });
      const privacyNote = isPrivate ? ' (🔒 Private execution enabled)' : '';
      await ctx.reply(`Select token to buy:${privacyNote}`, dcaTokenKeyboard());
      return;
    }

    if (subcommand === 'pause' || subcommand === 'resume' || subcommand === 'cancel') {
      const planId = args[1];
      if (!planId) {
        await ctx.reply(`Usage: /dca ${subcommand} <plan-id>`);
        return;
      }
      const newStatus = subcommand === 'pause' ? 'paused' : subcommand === 'resume' ? 'active' : 'cancelled';
      const updated = updateDCAPlan(planId, { status: newStatus });
      if (!updated) {
        await ctx.reply(`Plan ${planId} not found`);
        return;
      }
      syncJobs();
      await ctx.replyWithMarkdown(`Plan \`${planId}\` → *${newStatus}*`);
      return;
    }

    // Quick create: /dca SOL 5 solana */5 * * * * [--private]
    if (args.length >= 2) {
      const token = args[0];
      const amount = args[1];
      const chain = args[2] || config.defaultChain;
      const cronExpr = args.slice(3).join(' ') || '*/5 * * * *';

      const plan = createDCAPlan({
        toToken: token,
        amount,
        chain,
        cron: cronExpr,
        chatId: ctx.chat.id,
        policies: getDefaultPolicies('dca'),
        forcePrivate: isPrivate,
      });
      addDCAPlan(plan);
      syncJobs();

      const privacyBadge = isPrivate ? ' 🔒' : '';
      await ctx.replyWithMarkdown(formatDCAPlan(plan) + privacyBadge);
      return;
    }

    await ctx.reply(
      'Usage: /dca [create|list|pause|resume|cancel] [--private]\n' +
      'Quick: /dca <token> <amount> [chain] [cron] [--private]'
    );
  });

  // Wizard callbacks
  bot.action(/^dca_token_(.+)$/, async (ctx) => {
    const token = ctx.match[1];
    const wizard = _wizards.get(ctx.from.id);
    if (!wizard) return ctx.answerCbQuery('Session expired. Use /dca create');

    if (token === 'custom') {
      wizard.step = 'token_input';
      await ctx.editMessageText('Type the token symbol (e.g., BONK, JUP):');
    } else {
      wizard.toToken = token;
      wizard.step = 'amount';
      await ctx.editMessageText(`Token: ${token}\nSelect amount per buy:`, dcaAmountKeyboard());
    }
    await ctx.answerCbQuery();
  });

  bot.action(/^dca_amount_(.+)$/, async (ctx) => {
    const amount = ctx.match[1];
    const wizard = _wizards.get(ctx.from.id);
    if (!wizard) return ctx.answerCbQuery('Session expired');

    if (amount === 'custom') {
      wizard.step = 'amount_input';
      await ctx.editMessageText(`Token: ${wizard.toToken}\nType the USD amount per buy:`);
    } else {
      wizard.amount = amount;
      wizard.step = 'interval';
      await ctx.editMessageText(`Token: ${wizard.toToken} | Amount: $${amount}\nSelect interval:`, dcaIntervalKeyboard());
    }
    await ctx.answerCbQuery();
  });

  bot.action(/^dca_cron_(.+)$/, async (ctx) => {
    const cronExpr = ctx.match[1];
    const wizard = _wizards.get(ctx.from.id);
    if (!wizard) return ctx.answerCbQuery('Session expired');

    wizard.cron = cronExpr;
    wizard.step = 'chain';
    await ctx.editMessageText(
      `Token: ${wizard.toToken} | Amount: $${wizard.amount} | Cron: ${cronExpr}\nSelect chain:`,
      dcaChainKeyboard()
    );
    await ctx.answerCbQuery();
  });

  bot.action(/^dca_chain_(.+)$/, async (ctx) => {
    const chain = ctx.match[1];
    const wizard = _wizards.get(ctx.from.id);
    if (!wizard) return ctx.answerCbQuery('Session expired');

    // Create the plan (with forcePrivate if set during wizard start)
    const plan = createDCAPlan({
      toToken: wizard.toToken,
      amount: wizard.amount,
      chain,
      cron: wizard.cron,
      chatId: wizard.chatId,
      policies: getDefaultPolicies('dca'),
      forcePrivate: wizard.forcePrivate || false,
    });
    addDCAPlan(plan);
    syncJobs();
    _wizards.delete(ctx.from.id);

    const privacyBadge = wizard.forcePrivate ? ' 🔒 Private' : '';
    await ctx.editMessageText(`✅ DCA Plan Created!${privacyBadge}\n\n${formatDCAPlan(plan)}`, { parse_mode: 'Markdown' });
    await ctx.answerCbQuery('Plan created!');
  });

  // Manage callbacks
  bot.action(/^dca_(pause|resume|cancel)_(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    const planId = ctx.match[2];
    const newStatus = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'cancelled';
    const updated = updateDCAPlan(planId, { status: newStatus });
    if (!updated) return ctx.answerCbQuery('Plan not found');
    syncJobs();
    await ctx.answerCbQuery(`Plan ${newStatus}`);
    await ctx.editMessageText(`Plan \`${planId}\` → *${newStatus}*`, { parse_mode: 'Markdown' });
  });

  // Handle text input for wizard steps
  bot.on('text', async (ctx, next) => {
    const wizard = _wizards.get(ctx.from?.id);
    if (!wizard) return next();

    if (wizard.step === 'token_input') {
      wizard.toToken = ctx.message.text.toUpperCase();
      wizard.step = 'amount';
      await ctx.reply(`Token: ${wizard.toToken}\nSelect amount per buy:`, dcaAmountKeyboard());
      return;
    }

    if (wizard.step === 'amount_input') {
      const amount = parseFloat(ctx.message.text);
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply('Enter a valid positive number:');
        return;
      }
      wizard.amount = String(amount);
      wizard.step = 'interval';
      await ctx.reply(`Token: ${wizard.toToken} | Amount: $${amount}\nSelect interval:`, dcaIntervalKeyboard());
      return;
    }

    return next();
  });
}
