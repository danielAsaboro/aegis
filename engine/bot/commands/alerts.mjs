/**
 * /alerts — Price alerts + dip buyer / take profit configuration.
 *
 * Usage:
 *   /alerts                    — list active alerts
 *   /alerts add                — interactive wizard
 *   /alerts add SOL below 5 USDC 10 solana  — quick create
 */

import { createPriceAlert } from '../../core/types.mjs';
import { addPriceAlert, getPriceAlerts, updatePriceAlert } from '../../store/plans.mjs';
import { getDefaultPolicies } from '../../policies/engine.mjs';
import { formatAlertList } from '../formatters.mjs';
import { alertTypeKeyboard, alertThresholdKeyboard } from '../keyboards.mjs';

const _wizards = new Map();

export function registerAlerts(bot, config) {
  bot.command('alerts', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const subcommand = args[0];

    if (!subcommand || subcommand === 'list') {
      const alerts = await getPriceAlerts(ctx.chat.id);
      await ctx.replyWithMarkdown(formatAlertList(alerts));
      return;
    }

    if (subcommand === 'add') {
      // Quick create: /alerts add SOL below 5 USDC 10 solana
      if (args.length >= 4) {
        const [, token, direction, threshold, buyToken, buyAmount, chain] = args;
        const alert = createPriceAlert({
          token: token.toUpperCase(),
          chain: chain || config.defaultChain,
          type: direction === 'below' ? 'dip-buyer' : 'take-profit',
          direction,
          threshold,
          buyToken: buyToken?.toUpperCase(),
          buyAmount,
          chatId: ctx.chat.id,
          policies: getDefaultPolicies(direction === 'below' ? 'dip-buyer' : 'take-profit'),
        });
        await addPriceAlert(alert);
        await ctx.replyWithMarkdown(
          `✅ Alert created: *${alert.token}* ${alert.direction} ${alert.threshold}%` +
          (alert.buyToken ? ` → Buy ${alert.buyAmount} ${alert.buyToken}` : '')
        );
        return;
      }

      // Wizard
      _wizards.set(ctx.from.id, { step: 'type', chatId: ctx.chat.id });
      await ctx.reply('Select alert type:', alertTypeKeyboard());
      return;
    }

    if (subcommand === 'remove') {
      const alertId = args[1];
      if (!alertId) return ctx.reply('Usage: /alerts remove <alert-id>');
      const updated = await updatePriceAlert(alertId, { status: 'cancelled' });
      if (!updated) return ctx.reply('Alert not found');
      await ctx.replyWithMarkdown(`Alert \`${alertId}\` cancelled`);
      return;
    }

    await ctx.reply('Usage: /alerts [list|add|remove]');
  });

  bot.action(/^alert_type_(.+)$/, async (ctx) => {
    const type = ctx.match[1];
    const wizard = _wizards.get(ctx.from.id);
    if (!wizard) return ctx.answerCbQuery('Session expired');

    wizard.type = type;
    wizard.direction = type === 'dip-buyer' ? 'below' : 'above';
    wizard.step = 'token';
    await ctx.editMessageText(`Type: ${type}\nEnter the token to watch (e.g., SOL):`);
    await ctx.answerCbQuery();
  });

  bot.action(/^alert_thresh_(.+)$/, async (ctx) => {
    const thresh = ctx.match[1];
    const wizard = _wizards.get(ctx.from.id);
    if (!wizard) return ctx.answerCbQuery('Session expired');

    if (thresh === 'custom') {
      wizard.step = 'threshold_input';
      await ctx.editMessageText('Enter threshold percentage:');
    } else {
      wizard.threshold = thresh;
      // Create the alert
      const alert = createPriceAlert({
        token: wizard.token,
        chain: config.defaultChain,
        type: wizard.type,
        direction: wizard.direction,
        threshold: thresh,
        buyToken: wizard.type !== 'alert-only' ? 'USDC' : null,
        buyAmount: wizard.type !== 'alert-only' ? '5' : null,
        chatId: wizard.chatId,
        policies: getDefaultPolicies(wizard.type === 'dip-buyer' ? 'dip-buyer' : 'take-profit'),
      });
      await addPriceAlert(alert);
      _wizards.delete(ctx.from.id);
      await ctx.editMessageText(
        `✅ Alert created: *${alert.token}* ${alert.direction} ${alert.threshold}%` +
        (alert.buyToken ? `\nAction: Buy ${alert.buyAmount} ${alert.buyToken}` : '\nAlert only (no auto-trade)'),
        { parse_mode: 'Markdown' }
      );
    }
    await ctx.answerCbQuery();
  });

  // Text handler for wizard
  bot.on('text', async (ctx, next) => {
    const wizard = _wizards.get(ctx.from?.id);
    if (!wizard) return next();

    if (wizard.step === 'token') {
      wizard.token = ctx.message.text.toUpperCase();
      wizard.step = 'threshold';
      await ctx.reply(`Token: ${wizard.token}\nSelect threshold:`, alertThresholdKeyboard());
      return;
    }

    if (wizard.step === 'threshold_input') {
      const thresh = parseFloat(ctx.message.text);
      if (isNaN(thresh) || thresh <= 0) {
        await ctx.reply('Enter a valid positive number:');
        return;
      }
      wizard.threshold = thresh;
      const alert = createPriceAlert({
        token: wizard.token,
        chain: config.defaultChain,
        type: wizard.type,
        direction: wizard.direction,
        threshold: thresh,
        buyToken: wizard.type !== 'alert-only' ? 'USDC' : null,
        buyAmount: wizard.type !== 'alert-only' ? '5' : null,
        chatId: wizard.chatId,
        policies: getDefaultPolicies(wizard.type === 'dip-buyer' ? 'dip-buyer' : 'take-profit'),
      });
      await addPriceAlert(alert);
      _wizards.delete(ctx.from.id);
      await ctx.replyWithMarkdown(
        `✅ Alert created: *${alert.token}* ${alert.direction} ${alert.threshold}%`
      );
      return;
    }

    return next();
  });
}
