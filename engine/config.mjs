/**
 * AEGIS configuration — validated environment variables.
 * Uses envalid for type-safe env parsing with sensible defaults.
 */

import { cleanEnv, str, num, bool } from 'envalid';
import { homedir } from 'node:os';
import { join } from 'node:path';

const env = cleanEnv(process.env, {
  // Required
  TELEGRAM_BOT_TOKEN: str({ desc: 'Telegram bot token from @BotFather' }),
  ZERION_API_KEY: str({ desc: 'Zerion API key from dashboard.zerion.io' }),

  // Wallet
  ZERION_AGENT_TOKEN: str({ default: '', desc: 'Agent token for unattended signing' }),

  // Optional API keys
  COINGECKO_API_KEY: str({ default: '', desc: 'CoinGecko API key for better rate limits' }),
  HELIUS_API_KEY: str({ default: '', desc: 'Helius API key for onchain data' }),

  // Polling intervals (ms)
  PRICE_POLL_INTERVAL: num({ default: 60_000, desc: 'Price monitor poll interval' }),
  PORTFOLIO_POLL_INTERVAL: num({ default: 300_000, desc: 'Portfolio monitor poll interval' }),
  WHALE_POLL_INTERVAL: num({ default: 120_000, desc: 'Whale monitor poll interval' }),

  // Defaults
  DEFAULT_CHAIN: str({ default: 'solana', desc: 'Default chain for trades' }),
  DEFAULT_SLIPPAGE: num({ default: 2, desc: 'Default slippage percentage' }),
  DEFAULT_WALLET: str({ default: '', desc: 'Default wallet name' }),

  // System
  LOG_LEVEL: str({ default: 'info', choices: ['debug', 'info', 'warn', 'error'] }),
  DATA_DIR: str({ default: join(homedir(), '.zerion', 'kraken'), desc: 'Data persistence directory' }),

  // MagicBlock Private Payments
  MAGICBLOCK_RPC_URL: str({ default: 'https://rpc.magicblock.app/devnet', desc: 'MagicBlock base RPC URL' }),
  MAGICBLOCK_EPHEMERAL_URL: str({ default: 'https://devnet.magicblock.app', desc: 'MagicBlock ephemeral rollup URL' }),

  // Privacy settings
  PRIVACY_MODE: str({ default: 'auto', choices: ['off', 'on', 'auto'], desc: 'Privacy mode: off=never, on=always, auto=threshold-based' }),
  PRIVACY_THRESHOLD_USD: num({ default: 100, desc: 'Use private execution for trades above this USD amount' }),
  PRIVACY_TOKENS: str({ default: 'SOL,USDC', desc: 'Comma-separated tokens that always use private execution' }),

  // Solana keypair for MagicBlock private execution (base58 or JSON array)
  SOLANA_PRIVATE_KEY: str({ default: '', desc: 'Solana private key for MagicBlock signing (base58 or [u8;64] JSON)' }),
});

export default env;
