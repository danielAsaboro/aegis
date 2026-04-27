/**
 * AEGIS Telegram Bot — setup, middleware, command registration.
 *
 * All commands are registered as separate modules.
 * The bot also listens for execution events to send notifications.
 */

import { Telegraf } from 'telegraf';
import { botLog } from '../core/logger.mjs';
import bus from '../core/event-bus.mjs';
import { formatExecution, formatDenied, formatWhaleActivity } from './formatters.mjs';

// Command registrations
import { registerStart } from './commands/start.mjs';
import { registerDCA } from './commands/dca.mjs';
import { registerTrade } from './commands/trade.mjs';
import { registerStatus } from './commands/status.mjs';
import { registerHistory } from './commands/history.mjs';
import { registerPolicy } from './commands/policy.mjs';
import { registerAlerts } from './commands/alerts.mjs';
import { registerRebalance } from './commands/rebalance.mjs';
import { registerPropose } from './commands/propose.mjs';
import { registerVote } from './commands/vote.mjs';
import { registerWhale } from './commands/whale.mjs';
import { registerShield } from './commands/shield.mjs';

/**
 * Create and configure the Telegram bot.
 * @param {object} config
 * @param {string} config.botToken - Telegram bot token
 * @param {string} config.walletName - OWS wallet name
 * @param {string} config.defaultChain - Default blockchain
 * @param {number} [config.requiredVotes] - Votes needed for group consensus
 * @returns {Telegraf}
 */
export function createBot(config) {
  const bot = new Telegraf(config.botToken);

  // Error handler
  bot.catch((err, ctx) => {
    botLog.error({ err: err.message, update: ctx.update?.update_id }, 'Bot error');
    ctx.reply(`Error: ${err.message}`).catch(() => {});
  });

  // Logging middleware
  bot.use(async (ctx, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    if (ctx.message?.text) {
      botLog.debug({ cmd: ctx.message.text.split(' ')[0], ms }, 'Command processed');
    }
  });

  // Register all commands
  registerStart(bot, config);
  registerDCA(bot, config);
  registerTrade(bot, config);
  registerStatus(bot, config);
  registerHistory(bot);
  registerPolicy(bot);
  registerAlerts(bot, config);
  registerRebalance(bot, config);
  registerPropose(bot, config);
  registerVote(bot, config);
  registerWhale(bot);
  registerShield(bot, config);

  // Help command
  bot.command('help', (ctx) => ctx.reply(
    'AEGIS Commands:\n\n' +
    '/start — Welcome + wallet info\n' +
    '/dca — DCA plans (create/list/pause/cancel)\n' +
    '/rebalance — Portfolio rebalancing\n' +
    '/alerts — Price alerts & auto-trading\n' +
    '/trade — Manual swap (add --private for private execution)\n' +
    '/propose — Group trade proposal\n' +
    '/vote — Vote on proposals\n' +
    '/status — Portfolio + active strategies\n' +
    '/history — Execution log\n' +
    '/policy — View active policies\n' +
    '/whale — Whale tracking\n' +
    '/shield — Private balance (MagicBlock)\n' +
    '/help — This message'
  ));

  return bot;
}

/**
 * Set up event bus listeners that notify via Telegram.
 * @param {Telegraf} bot
 * @param {Map<string, number>} chatIds - Strategy/alert to chatId mapping
 */
export function setupNotifications(bot) {
  // Strategy notification callback — used by BaseStrategy.onNotify()
  const notifyFn = async (event) => {
    const chatId = event.proposal?.signal?.chatId || event.result?.chatId;
    if (!chatId) return;

    try {
      if (event.type === 'executed' || event.type === 'failed') {
        await bot.telegram.sendMessage(chatId, formatExecution(event.result), { parse_mode: 'Markdown' });
      } else if (event.type === 'denied') {
        await bot.telegram.sendMessage(
          chatId,
          formatDenied(event.proposal, event.deniedBy, event.reason),
          { parse_mode: 'Markdown' }
        );
      }
    } catch (err) {
      botLog.warn({ err: err.message, chatId }, 'Failed to send notification');
    }
  };

  // Also listen on the event bus for execution events
  bus.on('EXECUTION_COMPLETE', async (result) => {
    const chatId = result.chatId;
    if (!chatId) return;
    try {
      await bot.telegram.sendMessage(chatId, formatExecution(result), { parse_mode: 'Markdown' });
    } catch (err) {
      botLog.warn({ err: err.message }, 'Notification failed');
    }
  });

  // Whale signals → notify
  bus.on('WHALE_BUY', async (signal) => {
    if (!signal.chatId) return;
    try {
      await bot.telegram.sendMessage(signal.chatId, formatWhaleActivity(signal), { parse_mode: 'Markdown' });
    } catch (err) {
      botLog.warn({ err: err.message }, 'Whale notification failed');
    }
  });

  bus.on('WHALE_SELL', async (signal) => {
    if (!signal.chatId) return;
    try {
      await bot.telegram.sendMessage(signal.chatId, formatWhaleActivity(signal), { parse_mode: 'Markdown' });
    } catch (err) {
      botLog.warn({ err: err.message }, 'Whale notification failed');
    }
  });

  return notifyFn;
}
