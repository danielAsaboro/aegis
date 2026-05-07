/**
 * Telegram notification channel — uses sendMessage on the Telegram Bot
 * API. Requires AEGIS_TELEGRAM_BOT_TOKEN + AEGIS_TELEGRAM_CHAT_ID. Falls
 * back to TELEGRAM_BOT_TOKEN (the legacy var) when AEGIS_* is unset.
 */

import { createLogger } from '../../core/logger.mjs';

const log = createLogger('notify.telegram');

export const id = 'telegram';

function token() {
  return process.env.AEGIS_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
}

function chatId() {
  return process.env.AEGIS_TELEGRAM_CHAT_ID || '';
}

export function isEnabled() {
  return !!(token() && chatId());
}

export async function send(notification) {
  const t = token();
  const c = chatId();
  if (!t || !c) return { ok: false, channel: 'telegram', error: 'missing_token_or_chat' };

  const lines = [];
  lines.push(`*Aegis · ${notification.level || 'info'}*`);
  if (notification.title) lines.push(`_${notification.title}_`);
  if (notification.body) lines.push(notification.body);
  if (notification.missionId) lines.push(`mission: \`${notification.missionId}\``);
  const text = lines.join('\n');

  try {
    const res = await fetch(`https://api.telegram.org/bot${t}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: c, text, parse_mode: 'Markdown' }),
    });
    if (!res.ok) {
      const body = await res.text();
      log.warn({ status: res.status, body: body.slice(0, 200) }, 'telegram send failed');
      return { ok: false, channel: 'telegram', error: `http_${res.status}` };
    }
    return { ok: true, channel: 'telegram' };
  } catch (err) {
    log.warn({ err: err.message }, 'telegram send threw');
    return { ok: false, channel: 'telegram', error: err.message };
  }
}
