/**
 * Webhook notification channel — POSTs JSON to AEGIS_NOTIFY_WEBHOOK_URL
 * with an HMAC-SHA256 signature in the X-Aegis-Signature header (when
 * AEGIS_NOTIFY_WEBHOOK_SECRET is set).
 */

import { createHmac } from 'node:crypto';
import { createLogger } from '../../core/logger.mjs';

const log = createLogger('notify.webhook');

export const id = 'webhook';

export function isEnabled() {
  return !!process.env.AEGIS_NOTIFY_WEBHOOK_URL;
}

function sign(body, secret) {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export async function send(notification) {
  const url = process.env.AEGIS_NOTIFY_WEBHOOK_URL;
  if (!url) return { ok: false, channel: 'webhook', error: 'no_url' };
  const secret = process.env.AEGIS_NOTIFY_WEBHOOK_SECRET || '';
  const body = JSON.stringify(notification);
  const headers = { 'content-type': 'application/json' };
  if (secret) headers['x-aegis-signature'] = sign(body, secret);

  // Critical-level events get one retry on transport failure.
  const retries = notification.level === 'critical' ? 1 : 0;
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, { method: 'POST', headers, body });
      if (res.ok) return { ok: true, channel: 'webhook', status: res.status };
      lastErr = `http_${res.status}`;
    } catch (err) {
      lastErr = err.message;
    }
  }
  log.warn({ err: lastErr }, 'webhook delivery failed');
  return { ok: false, channel: 'webhook', error: lastErr };
}
