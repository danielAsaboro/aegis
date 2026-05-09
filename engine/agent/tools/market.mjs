/**
 * Read-only market tools — token prices, search, supported chains.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { getTokenPrice as zerionGetTokenPrice } from '../../utils/zerion-api.mjs';
import * as api from '../../../cli/utils/api/client.js';
import { SUPPORTED_CHAINS } from '../../../cli/utils/chain/registry.js';

export const getTokenPrice = tool({
  description: 'Fetch the current USD price and 24h change for a token by symbol or fungible id.',
  inputSchema: z.object({
    token: z.string().describe('Token symbol (e.g. "SOL", "USDC") or Zerion fungible id.'),
    chain: z.string().optional().describe('Chain hint (solana, ethereum, base, ...). Default: solana.'),
  }),
  execute: async ({ token, chain }) => {
    const result = await zerionGetTokenPrice(token, chain || 'solana');
    return result;
  },
});

export const searchToken = tool({
  description: 'Search for a token by name or symbol. Returns the top matches with their fungible ids, market cap and price.',
  inputSchema: z.object({
    query: z.string().describe('Search query (symbol, name, or partial match).'),
    chain: z.string().optional(),
    limit: z.number().int().positive().max(20).optional(),
  }),
  execute: async ({ query, chain, limit = 5 }) => {
    const result = await api.searchFungibles(query, { chainId: chain, limit });
    const items = (result?.data || []).slice(0, limit).map(f => ({
      id: f.id,
      symbol: f.attributes?.symbol,
      name: f.attributes?.name,
      price: f.attributes?.market_data?.price,
      marketCap: f.attributes?.market_data?.market_cap,
      change24h: f.attributes?.market_data?.changes?.percent_1d,
      implementations: (f.attributes?.implementations || []).map(i => ({
        chain: i.chain_id,
        address: i.address,
      })),
    }));
    return { query, count: items.length, results: items };
  },
});

export const listChains = tool({
  description: 'List the chains AEGIS supports for trading and analytics.',
  inputSchema: z.object({}),
  execute: async () => {
    return { chains: SUPPORTED_CHAINS };
  },
});
