/**
 * Price Monitor — polls token prices and emits PRICE_DIP, PRICE_SPIKE, THRESHOLD_HIT signals.
 *
 * Data source: Zerion Fungibles API (or CoinGecko fallback).
 * Compares current price to stored reference price for each alert.
 */

import bus from '../core/event-bus.mjs';
import { SignalType } from '../core/types.mjs';
import { monitorLog } from '../core/logger.mjs';
import { getTokenPrice } from '../utils/zerion-api.mjs';
import { setPrice, getPrice } from '../store/state.mjs';
import { getActivePriceAlerts } from '../store/plans.mjs';

let _interval = null;

/**
 * Start the price monitor.
 * @param {number} pollIntervalMs - How often to poll (default: 60s)
 */
export function startPriceMonitor(pollIntervalMs = 60_000) {
  monitorLog.info({ interval: pollIntervalMs }, 'Starting price monitor');

  // Initial check
  checkPrices();

  _interval = setInterval(checkPrices, pollIntervalMs);
  return () => stopPriceMonitor();
}

export function stopPriceMonitor() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
    monitorLog.info('Price monitor stopped');
  }
}

async function checkPrices() {
  const alerts = getActivePriceAlerts();
  if (alerts.length === 0) return;

  // Dedupe tokens to minimize API calls
  const tokensToCheck = new Map();
  for (const alert of alerts) {
    const key = `${alert.token}:${alert.chain}`;
    if (!tokensToCheck.has(key)) {
      tokensToCheck.set(key, { token: alert.token, chain: alert.chain });
    }
  }

  for (const [key, { token, chain }] of tokensToCheck) {
    try {
      const priceData = await getTokenPrice(token, chain);
      if (!priceData || !priceData.price) continue;

      const prev = getPrice(token, chain);
      const prevPrice = prev?.price || null;
      setPrice(token, chain, priceData.price);

      // Process alerts for this token
      const tokenAlerts = alerts.filter(a => a.token === token && a.chain === chain);
      for (const alert of tokenAlerts) {
        // Set reference price on first check
        if (!alert.referencePrice) {
          alert.referencePrice = priceData.price;
          continue;
        }

        const refPrice = alert.referencePrice;
        const currentPrice = priceData.price;
        const changePercent = ((currentPrice - refPrice) / refPrice) * 100;

        // Check for dip (price dropped below threshold)
        if (alert.direction === 'below' && changePercent <= -alert.threshold) {
          monitorLog.info({
            token, chain,
            price: currentPrice,
            drop: changePercent.toFixed(2),
            threshold: alert.threshold,
          }, 'Price dip detected');

          bus.signal(SignalType.PRICE_DIP, {
            token,
            chain,
            price: currentPrice,
            referencePrice: refPrice,
            dropPercent: Math.abs(changePercent),
            alertId: alert.id,
            buyToken: alert.buyToken,
            buyAmount: alert.buyAmount,
          });
        }

        // Check for spike (price rose above threshold)
        if (alert.direction === 'above' && changePercent >= alert.threshold) {
          monitorLog.info({
            token, chain,
            price: currentPrice,
            gain: changePercent.toFixed(2),
            threshold: alert.threshold,
          }, 'Price spike detected');

          bus.signal(SignalType.PRICE_SPIKE, {
            token,
            chain,
            price: currentPrice,
            referencePrice: refPrice,
            gainPercent: changePercent,
            alertId: alert.id,
          });
        }
      }
    } catch (err) {
      monitorLog.warn({ err: err.message, token, chain }, 'Price check failed');
    }
  }
}

export { checkPrices };
