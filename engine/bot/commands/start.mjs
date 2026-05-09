/**
 * /start — Welcome wizard + wallet info display.
 */

import { listWallets, getEvmAddress, getSolAddress } from '../../../cli/utils/wallet/keystore.js';
import { formatWelcome } from '../formatters.mjs';

export function registerStart(bot, config) {
  bot.command('start', async (ctx) => {
    try {
      const walletName = config.walletName;
      let evmAddr, solAddr;

      try {
        evmAddr = getEvmAddress(walletName);
      } catch { /* no EVM account */ }

      try {
        solAddr = getSolAddress(walletName);
      } catch { /* no SOL account */ }

      await ctx.replyWithMarkdown(formatWelcome(walletName, evmAddr, solAddr));
    } catch (err) {
      await ctx.reply(`Setup error: ${err.message}\n\nMake sure you've created a wallet: zerion wallet create <name>`);
    }
  });
}
