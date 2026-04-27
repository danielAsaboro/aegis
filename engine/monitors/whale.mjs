/**
 * Whale Monitor — tracks large wallet transactions.
 *
 * Polls Zerion Transactions API for watched wallets.
 * Emits WHALE_BUY / WHALE_SELL signals when large transfers are detected.
 */

import bus from '../core/event-bus.mjs';
import { SignalType } from '../core/types.mjs';
import { monitorLog } from '../core/logger.mjs';
import { getWalletTransactions } from '../utils/zerion-api.mjs';
import { getWhaleWatches } from '../store/plans.mjs';
import { setLastChecked, getLastChecked } from '../store/state.mjs';

let _interval = null;
const MIN_VALUE_USD = 1000; // Minimum USD value to trigger signal

/**
 * Start whale monitor.
 * @param {number} pollIntervalMs - How often to poll (default: 2min)
 */
export function startWhaleMonitor(pollIntervalMs = 120_000) {
  monitorLog.info({ interval: pollIntervalMs }, 'Starting whale monitor');

  checkWhaleActivity();
  _interval = setInterval(checkWhaleActivity, pollIntervalMs);
  return () => stopWhaleMonitor();
}

export function stopWhaleMonitor() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
    monitorLog.info('Whale monitor stopped');
  }
}

async function checkWhaleActivity() {
  const watches = getWhaleWatches();
  if (watches.length === 0) return;

  for (const watch of watches) {
    const monitorId = `whale:${watch.address}`;
    try {
      const txs = await getWalletTransactions(watch.address, { limit: 5 });
      const lastChecked = getLastChecked(monitorId);
      setLastChecked(monitorId);

      for (const tx of txs) {
        // Skip if we've already seen this transaction
        if (lastChecked && new Date(tx.minedAt) <= new Date(lastChecked)) continue;
        if (tx.status !== 'confirmed') continue;

        for (const transfer of tx.transfers) {
          if (!transfer.value || transfer.value < MIN_VALUE_USD) continue;

          const isBuy = transfer.direction === 'in';
          const signalType = isBuy ? SignalType.WHALE_BUY : SignalType.WHALE_SELL;

          monitorLog.info({
            wallet: watch.address,
            label: watch.label,
            type: isBuy ? 'BUY' : 'SELL',
            token: transfer.token,
            value: transfer.value,
          }, 'Whale activity detected');

          bus.signal(signalType, {
            wallet: watch.address,
            label: watch.label || watch.address.slice(0, 8),
            token: transfer.token,
            quantity: transfer.quantity,
            value: transfer.value,
            txId: tx.id,
            chatId: watch.chatId,
          });
        }
      }
    } catch (err) {
      monitorLog.warn({ err: err.message, wallet: watch.address }, 'Whale check failed');
    }
  }
}

export { checkWhaleActivity };
