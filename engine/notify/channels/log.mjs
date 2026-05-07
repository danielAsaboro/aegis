/**
 * Log channel — appends to ~/.zerion/aegis/logs/notify.ndjson and
 * broadcasts a `notification` IPC event so attached TUIs can render
 * the inbox.
 */

import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import env from '../../config.mjs';
import bus from '../../core/event-bus.mjs';
import { createLogger } from '../../core/logger.mjs';

const log = createLogger('notify.log');

export const id = 'log';

export function isEnabled() {
  return true;
}

export async function send(notification) {
  const dir = join(env.DATA_DIR, 'logs');
  try {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'notify.ndjson');
    appendFileSync(file, JSON.stringify(notification) + '\n');
  } catch (err) {
    log.warn({ err: err.message }, 'log channel write failed');
  }
  // Always broadcast to attached IPC listeners so TUIs can render the
  // inbox without re-reading the file.
  bus.emit('NOTIFICATION', notification);
  return { ok: true, channel: 'log' };
}
