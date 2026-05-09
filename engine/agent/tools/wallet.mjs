/**
 * Wallet tools — read-only.
 *
 * Destructive ops (create / delete / import wallet, create / revoke
 * agent token) are intentionally NOT exposed to the agent — they stay
 * in the human-only CLI.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { listWallets, getWallet } from '../../../cli/utils/wallet/keystore.js';

export const listWalletsTool = tool({
  description: 'List all wallets known to the OWS keystore (name, EVM address, Solana address, creation timestamp).',
  inputSchema: z.object({}),
  execute: async () => {
    const wallets = listWallets().map(w => ({
      name: w.name,
      id: w.id,
      evmAddress: w.evmAddress,
      solAddress: w.solAddress,
      chains: w.chains,
      createdAt: w.createdAt,
    }));
    return { count: wallets.length, wallets };
  },
});

export const getWalletAddresses = tool({
  description: 'Get the EVM and Solana addresses for a specific wallet by name or id.',
  inputSchema: z.object({
    walletName: z.string().describe('Wallet name or id.'),
  }),
  execute: async ({ walletName }) => {
    const w = getWallet(walletName);
    if (!w) throw new Error(`No wallet named "${walletName}".`);
    return {
      name: w.name,
      id: w.id,
      evmAddress: w.evmAddress,
      solAddress: w.solAddress,
      chains: w.chains,
    };
  },
});
