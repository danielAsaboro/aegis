/**
 * Thin Zerion API wrapper for AEGIS monitors.
 * Re-exports CLI client functions + adds convenience methods.
 */

import {
  getPortfolio,
  getPositions,
  getTransactions,
  searchFungibles,
  getFungible,
  getChains,
} from '../../cli/utils/api/client.js';
import { getSwapQuote, executeSwap } from '../../cli/utils/trading/swap.js';
import { resolveToken } from '../../cli/utils/trading/resolve-token.js';
import { monitorLog } from '../core/logger.mjs';

// Re-export core functions
export { getPortfolio, getPositions, getTransactions, searchFungibles, getFungible, getChains, getSwapQuote, executeSwap, resolveToken };

/**
 * Get token price in USD via Zerion Fungibles API.
 */
export async function getTokenPrice(tokenQuery, chain) {
  try {
    const resolved = await resolveToken(tokenQuery, chain);
    const fungible = await getFungible(resolved.fungibleId);
    const price = fungible?.data?.attributes?.market_data?.price;
    return {
      token: resolved.symbol,
      fungibleId: resolved.fungibleId,
      price: price || 0,
      change24h: fungible?.data?.attributes?.market_data?.changes?.percent_1d || 0,
    };
  } catch (err) {
    monitorLog.warn({ err: err.message, token: tokenQuery }, 'Failed to get token price');
    return null;
  }
}

/**
 * Get portfolio positions with allocation percentages.
 */
export async function getPortfolioAllocations(walletAddress, chain) {
  const positions = await getPositions(walletAddress, { chainId: chain });
  const items = (positions.data || []).map(p => {
    const attrs = p.attributes;
    return {
      token: attrs.fungible_info?.symbol || 'UNKNOWN',
      name: attrs.fungible_info?.name || '',
      value: attrs.value || 0,
      quantity: attrs.quantity?.float || 0,
      price: attrs.price || 0,
    };
  });

  const totalValue = items.reduce((sum, i) => sum + i.value, 0);
  return items.map(i => ({
    ...i,
    allocation: totalValue > 0 ? (i.value / totalValue) * 100 : 0,
  }));
}

/**
 * Get recent large transactions for a wallet (whale tracking).
 */
export async function getWalletTransactions(walletAddress, { chain, limit = 10 } = {}) {
  const txs = await getTransactions(walletAddress, { chainId: chain, limit });
  return (txs.data || []).map(tx => {
    const attrs = tx.attributes;
    return {
      id: tx.id,
      type: attrs.operation_type,
      status: attrs.status,
      minedAt: attrs.mined_at,
      fee: attrs.fee?.value,
      transfers: (attrs.transfers || []).map(t => ({
        direction: t.direction,
        token: t.fungible_info?.symbol,
        quantity: t.quantity?.float,
        value: t.value,
        from: t.sender,
        to: t.recipient,
      })),
    };
  });
}

/**
 * Get portfolio total value.
 */
export async function getPortfolioValue(walletAddress) {
  const portfolio = await getPortfolio(walletAddress);
  return {
    totalValue: portfolio?.data?.attributes?.total?.positions || 0,
    change24h: portfolio?.data?.attributes?.changes?.percent_1d || 0,
  };
}
