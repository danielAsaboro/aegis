/**
 * macOS notification channel — uses osascript display notification.
 *
 * Disabled on non-darwin platforms.
 */

import { spawn } from 'node:child_process';
import { createLogger } from '../../core/logger.mjs';

const log = createLogger('notify.macos');

export const id = 'macos';

export function isEnabled() {
  if (process.platform !== 'darwin') return false;
  if (process.env.AEGIS_NOTIFY_MACOS === '0') return false;
  return true;
}

function escape(s) {
  return String(s ?? '').replace(/["\\]/g, '\\$&');
}

export async function send(notification) {
  const title = escape(`Aegis: ${notification.title || 'notification'}`);
  const body = escape(notification.body || '');
  const script = `display notification "${body}" with title "${title}"`;
  return new Promise((resolve) => {
    try {
      const child = spawn('osascript', ['-e', script], { stdio: 'ignore' });
      child.on('close', (code) => resolve({ ok: code === 0, channel: 'macos' }));
      child.on('error', (err) => {
        log.warn({ err: err.message }, 'osascript failed');
        resolve({ ok: false, channel: 'macos', error: err.message });
      });
    } catch (err) {
      log.warn({ err: err.message }, 'macos notification spawn failed');
      resolve({ ok: false, channel: 'macos', error: err.message });
    }
  });
}
