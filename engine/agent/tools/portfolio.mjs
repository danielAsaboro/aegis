/**
 * Read-only portfolio tools — wrap the Zerion API client.
 *
 * All tools resolve the wallet address from the OWS keystore so the LLM
 * never has to pass raw addresses. The tool's experimental_context (set by
 * runAgentTurn) carries the active wallet name; if a tool is invoked
 * without that context, it falls back to env.DEFAULT_WALLET.
 */

import { tool } from 'ai';
import { z } from 'zod';
import * as api from '../../../cli/utils/api/client.js';
import { getEvmAddress, getSolAddress } from '../../../cli/utils/wallet/keystore.js';
import { isSolana } from '../../../cli/utils/chain/registry.js';
import env from '../../config.mjs';

function resolveWalletAddress(walletName, chain) {
  const name = walletName || env.DEFAULT_WALLET || 'default';
  return isSolana(chain) ? getSolAddress(name) : getEvmAddress(name);
}

function activeWalletFromContext(ctx) {
  return ctx?.experimental_context?.walletName || env.DEFAULT_WALLET || 'default';
}

export const getPortfolio = tool({
  description: 'Fetch the active wallet\'s aggregate portfolio (total value, positions count, PnL summary) from Zerion. Returns USD-denominated.',
  inputSchema: z.object({
    walletName: z.string().optional().describe('OWS wallet name. Defaults to the active wallet.'),
    chain: z.string().optional().describe('Optional chain to scope by (solana, ethereum, base, ...). Defaults to all chains.'),
  }),
  execute: async ({ walletName, chain }, ctx) => {
    const name = walletName || activeWalletFromContext(ctx);
    const address = resolveWalletAddress(name, chain || env.DEFAULT_CHAIN);
    if (!address) throw new Error(`Wallet "${name}" has no ${chain || 'address'} configured.`);
    const result = await api.getPortfolio(address);
    return { walletName: name, address, portfolio: result?.data?.attributes ?? result };
  },
});

export const getPositions = tool({
  description: 'List the active wallet\'s token positions, sorted by USD value descending.',
  inputSchema: z.object({
    walletName: z.string().optional(),
    chain: z.string().optional().describe('Restrict to one chain (solana, ethereum, ...).'),
    limit: z.number().int().positive().max(100).optional().describe('Cap the number of positions returned. Default 25.'),
  }),
  execute: async ({ walletName, chain, limit = 25 }, ctx) => {
    const name = walletName || activeWalletFromContext(ctx);
    const address = resolveWalletAddress(name, chain || env.DEFAULT_CHAIN);
    if (!address) throw new Error(`Wallet "${name}" has no ${chain || 'address'} configured.`);
    const result = await api.getPositions(address, { chainId: chain });
    const items = (result?.data || []).slice(0, limit).map(p => ({
      symbol: p.attributes?.fungible_info?.symbol,
      name: p.attributes?.fungible_info?.name,
      chain: p.relationships?.chain?.data?.id,
      quantity: p.attributes?.quantity?.float,
      value: p.attributes?.value,
      price: p.attributes?.price,
    }));
    return { walletName: name, address, count: items.length, positions: items };
  },
});

export const getPnl = tool({
  description: 'Get realized + unrealized PnL for the active wallet, plus net invested.',
  inputSchema: z.object({
    walletName: z.string().optional(),
  }),
  execute: async ({ walletName }, ctx) => {
    const name = walletName || activeWalletFromContext(ctx);
    const address = resolveWalletAddress(name, env.DEFAULT_CHAIN);
    if (!address) throw new Error(`Wallet "${name}" has no address configured.`);
    const result = await api.getPnl(address);
    return { walletName: name, address, pnl: result?.data?.attributes ?? result };
  },
});

export const getHistory = tool({
  description: 'Return recent onchain transactions for the active wallet from Zerion.',
  inputSchema: z.object({
    walletName: z.string().optional(),
    chain: z.string().optional(),
    limit: z.number().int().positive().max(50).optional().describe('Default 10.'),
  }),
  execute: async ({ walletName, chain, limit = 10 }, ctx) => {
    const name = walletName || activeWalletFromContext(ctx);
    const address = resolveWalletAddress(name, chain || env.DEFAULT_CHAIN);
    if (!address) throw new Error(`Wallet "${name}" has no ${chain || 'address'} configured.`);
    const result = await api.getTransactions(address, { chainId: chain, limit });
    const items = (result?.data || []).map(tx => ({
      hash: tx.attributes?.hash,
      type: tx.attributes?.operation_type,
      timestamp: tx.attributes?.mined_at,
      status: tx.attributes?.status,
      chain: tx.relationships?.chain?.data?.id,
      transfers: (tx.attributes?.transfers || []).map(t => ({
        direction: t.direction,
        symbol: t.fungible_info?.symbol,
        quantity: t.quantity?.float,
        value: t.value,
      })),
    }));
    return { walletName: name, address, transactions: items };
  },
});
