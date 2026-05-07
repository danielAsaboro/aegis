/**
 * Notifier — fan-out for autonomous-agent notifications.
 *
 * Levels and default channel routing:
 *   info       → log + tui inbox
 *   warn       → log + tui inbox + macos
 *   excursion  → all enabled channels (this is the human-in-the-loop ask)
 *   critical   → all enabled channels + webhook retry on failure
 *
 * Per-call `channels` overrides the level routing. Channels auto-fan-out
 * based on env config (each channel exports isEnabled()).
 */

import * as logChannel from './channels/log.mjs';
import * as macosChannel from './channels/macos.mjs';
import * as telegramChannel from './channels/telegram.mjs';
import * as webhookChannel from './channels/webhook.mjs';
import { createLogger } from '../core/logger.mjs';

const log = createLogger('notify');

const CHANNELS = {
  log: logChannel,
  macos: macosChannel,
  telegram: telegramChannel,
  webhook: webhookChannel,
};

const LEVEL_ROUTING = {
  info: ['log'],
  warn: ['log', 'macos'],
  excursion: ['log', 'macos', 'telegram', 'webhook'],
  critical: ['log', 'macos', 'telegram', 'webhook'],
};

const VALID_LEVELS = new Set(Object.keys(LEVEL_ROUTING));

/**
 * Send a notification.
 *
 * @param {object} opts
 * @param {'info'|'warn'|'excursion'|'critical'} opts.level
 * @param {string} opts.title
 * @param {string} [opts.body]
 * @param {string[]} [opts.channels] — override level routing
 * @param {string} [opts.missionId]
 * @param {object} [opts.payload] — additional context (executionId, txHash, etc.)
 */
export async function notify({ level = 'info', title, body, channels, missionId, payload } = {}) {
  if (!VALID_LEVELS.has(level)) level = 'info';
  const notification = {
    level,
    title: title || '',
    body: body || '',
    missionId: missionId || null,
    payload: payload || null,
    timestamp: new Date().toISOString(),
  };

  const targets = (channels && channels.length ? channels : LEVEL_ROUTING[level]) || ['log'];

  // Always include the log channel — it's also the IPC broadcast path.
  if (!targets.includes('log')) targets.unshift('log');

  const results = [];
  for (const channelId of targets) {
    const channel = CHANNELS[channelId];
    if (!channel) continue;
    if (!channel.isEnabled()) {
      results.push({ ok: false, channel: channelId, error: 'disabled' });
      continue;
    }
    try {
      const result = await channel.send(notification);
      results.push(result);
    } catch (err) {
      log.warn({ channel: channelId, err: err.message }, 'channel threw');
      results.push({ ok: false, channel: channelId, error: err.message });
    }
  }

  return { notification, results };
}

export function listChannels() {
  return Object.entries(CHANNELS).map(([key, c]) => ({
    id: key,
    enabled: c.isEnabled(),
  }));
}
