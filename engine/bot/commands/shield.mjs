/**
 * /shield — MagicBlock private balance management.
 *
 * Commands:
 *   /shield — Show shielded balances
 *   /shield deposit <amount> <token> — Deposit to shield
 *   /shield withdraw <amount> <token> — Withdraw from shield
 *   /shield history — Transaction history
 *   /shield settings [mode] — View/change privacy settings
 */

import {
  depositToShield,
  withdrawFromShield,
  getAllShieldBalances,
} from '../../execution/private-executor.mjs';
import {
  getShieldHistory,
  recordShieldTransaction,
} from '../../store/shield.mjs';
import { getPrivacyConfig } from '../../policies/privacy.mjs';
import { getKeypair } from '../../lib/keypair.mjs';
import { getTokenDecimals } from '../../lib/magicblock/client.mjs';
import {
  formatShieldBalances,
  formatShieldDeposit,
  formatShieldWithdraw,
  formatShieldHistory,
  formatPrivacySettings,
} from '../formatters.mjs';
import { botLog } from '../../core/logger.mjs';

export function registerShield(bot, config) {
  bot.command('shield', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const subcommand = args[0]?.toLowerCase();

    // Get keypair from env var
    const keypair = getKeypair();

    // /shield (no args) — show balances
    if (!subcommand || subcommand === 'balance') {
      await handleBalance(ctx, keypair);
      return;
    }

    // /shield deposit <amount> <token>
    if (subcommand === 'deposit') {
      const amount = parseFloat(args[1]);
      const token = (args[2] || 'USDC').toUpperCase();

      if (isNaN(amount) || amount <= 0) {
        await ctx.reply('Usage: /shield deposit <amount> <token>\nExample: /shield deposit 10 USDC');
        return;
      }

      if (!keypair) {
        await ctx.reply(
          'Keypair not configured for MagicBlock.\n\n' +
          'Set SOLANA_PRIVATE_KEY in your .env.local or .env.devnet file:\n' +
          '`SOLANA_PRIVATE_KEY=<base58 or JSON array>`'
        );
        return;
      }

      await ctx.reply(`Depositing ${amount} ${token} to shield...`);

      try {
        const { signature, balance } = await depositToShield(keypair, token, amount);
        const decimals = getTokenDecimals(token);

        // Record transaction
        await recordShieldTransaction({
          type: 'deposit',
          wallet: keypair.publicKey.toBase58(),
          token,
          amount: BigInt(Math.round(amount * 10 ** decimals)).toString(),
          signature,
        });

        await ctx.replyWithMarkdown(formatShieldDeposit(token, amount, signature, balance));
      } catch (err) {
        botLog.error({ err: err.message }, 'Shield deposit failed');
        await ctx.reply(`Deposit failed: ${err.message}`);
      }
      return;
    }

    // /shield withdraw <amount> <token>
    if (subcommand === 'withdraw') {
      const amount = parseFloat(args[1]);
      const token = (args[2] || 'USDC').toUpperCase();

      if (isNaN(amount) || amount <= 0) {
        await ctx.reply('Usage: /shield withdraw <amount> <token>\nExample: /shield withdraw 5 USDC');
        return;
      }

      if (!keypair) {
        await ctx.reply(
          'Keypair not configured for MagicBlock.\n\n' +
          'Set SOLANA_PRIVATE_KEY in your .env.local or .env.devnet file.'
        );
        return;
      }

      await ctx.reply(`Withdrawing ${amount} ${token} from shield...`);

      try {
        const { signature, balance } = await withdrawFromShield(keypair, token, amount);
        const decimals = getTokenDecimals(token);

        await recordShieldTransaction({
          type: 'withdraw',
          wallet: keypair.publicKey.toBase58(),
          token,
          amount: BigInt(Math.round(amount * 10 ** decimals)).toString(),
          signature,
        });

        await ctx.replyWithMarkdown(formatShieldWithdraw(token, amount, signature, balance));
      } catch (err) {
        botLog.error({ err: err.message }, 'Shield withdraw failed');
        await ctx.reply(`Withdraw failed: ${err.message}`);
      }
      return;
    }

    // /shield history
    if (subcommand === 'history') {
      const wallet = keypair?.publicKey?.toBase58();
      const history = wallet ? await getShieldHistory(wallet) : [];
      await ctx.replyWithMarkdown(formatShieldHistory(history));
      return;
    }

    // /shield settings [mode]
    if (subcommand === 'settings') {
      const newMode = args[1]?.toLowerCase();

      if (newMode && ['off', 'on', 'auto'].includes(newMode)) {
        const current = getPrivacyConfig();
        await ctx.reply(
          `Privacy settings are currently env-driven and cannot be changed at runtime.\n` +
          `Requested: ${newMode}\n` +
          `Current mode: ${current.mode}`
        );
        return;
      }

      const privacyConfig = getPrivacyConfig();
      await ctx.replyWithMarkdown(formatPrivacySettings(privacyConfig));
      return;
    }

    // Unknown subcommand
    await ctx.replyWithMarkdown([
      '*Shield Commands* (MagicBlock Privacy)\n',
      '`/shield` — View shielded balances',
      '`/shield deposit <amount> <token>` — Deposit to shield',
      '`/shield withdraw <amount> <token>` — Withdraw from shield',
      '`/shield history` — Transaction history',
      '`/shield settings` — Privacy settings',
      '',
      '_Shielded funds are held privately in MagicBlock ephemeral rollups._',
    ].join('\n'));
  });
}

async function handleBalance(ctx, keypair) {
  if (!keypair) {
    // Show local cached balances if no keypair
    const localBalances = {};
    await ctx.replyWithMarkdown(formatShieldBalances(localBalances));
    return;
  }

  try {
    await ctx.reply('Fetching shielded balances...');
    const balances = await getAllShieldBalances(keypair);
    await ctx.replyWithMarkdown(formatShieldBalances(balances));
  } catch (err) {
    botLog.error({ err: err.message }, 'Failed to fetch shield balances');
    await ctx.reply(`Failed to fetch balances: ${err.message}`);
  }
}
