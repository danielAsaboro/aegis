/**
 * AEGIS configuration — validated environment variables.
 * Uses envalid for type-safe env parsing with sensible defaults.
 */

import { cleanEnv, str, num, bool } from 'envalid';
import { homedir } from 'node:os';
import { join } from 'node:path';

const rawEnv = cleanEnv(process.env, {
  // Required at bot/Zerion-API call sites — defaulted to '' here so
  // startup paths that don't need them yet (e.g. studio / MCP boot)
  // can still load. Bot startup and tools that hit the Zerion API check
  // for non-empty values themselves.
  TELEGRAM_BOT_TOKEN: str({ default: '', desc: 'Telegram bot token from @BotFather' }),
  ZERION_API_KEY: str({ default: '', desc: 'Zerion API key from dashboard.zerion.io' }),

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
  LOG_LEVEL: str({ default: 'info', choices: ['debug', 'info', 'warn', 'error', 'fatal', 'silent'] }),
  DATA_DIR: str({ default: join(homedir(), '.zerion', 'aegis'), desc: 'Data persistence directory' }),

  // SQLite via Prisma. Relative file: paths are resolved against DATA_DIR.
  AEGIS_DATABASE_URL: str({ default: 'file:./aegis.db', desc: 'Prisma database URL (sqlite). Relative file: paths resolve under DATA_DIR.' }),

  // MagicBlock Private Payments
  MAGICBLOCK_RPC_URL: str({ default: 'https://rpc.magicblock.app/devnet', desc: 'MagicBlock base RPC URL' }),
  MAGICBLOCK_EPHEMERAL_URL: str({ default: 'https://devnet.magicblock.app', desc: 'MagicBlock ephemeral rollup URL' }),

  // Privacy settings
  PRIVACY_MODE: str({ default: 'auto', choices: ['off', 'on', 'auto'], desc: 'Privacy mode: off=never, on=always, auto=threshold-based' }),
  PRIVACY_THRESHOLD_USD: num({ default: 100, desc: 'Use private execution for trades above this USD amount' }),
  PRIVACY_TOKENS: str({ default: 'SOL,USDC', desc: 'Comma-separated tokens that always use private execution' }),

  // Solana keypair for MagicBlock private execution (base58 or JSON array)
  SOLANA_PRIVATE_KEY: str({ default: '', desc: 'Solana private key for MagicBlock signing (base58 or [u8;64] JSON)' }),

  // LLM agent layer.
  // Subscription + local only — AEGIS does not call API-key billed
  // endpoints. Two access modes:
  //   - codex/* — ChatGPT subscription via the user's local `codex` CLI
  //     driven as a raw language-model backend. AEGIS owns the tool loop.
  //   - qvac/*  — fully on-device LLM via the Bare-runtime QVAC sidecar
  //     (@qvac/llm-llamacpp). No keys, no cloud round-trips.
  AEGIS_AGENT_MODEL: str({ default: '', desc: 'Agent model id. Format: <provider>/<model>. Providers: codex (ChatGPT subscription), qvac (local). When unset, AEGIS prefers qvac/local if QVAC_LLM_MODEL_PATH is set, else codex/default.' }),
  CODEX_BIN: str({ default: 'codex', desc: 'Path to the Codex CLI binary (used by codex/* models). Defaults to PATH lookup.' }),
  CODEX_DEFAULT_MODEL: str({ default: '', desc: 'Optional model passed to the Codex MCP `model` parameter when AEGIS_AGENT_MODEL=codex/default. Leave blank to let Codex pick (recommended for ChatGPT-account auth — explicit "gpt-5" is rejected there).' }),
  AEGIS_AGENT_AUTONOMY: str({ default: 'advisory', choices: ['off', 'advisory', 'autonomous'], desc: 'Autonomous-signal mode: off (no LLM on signals), advisory (propose to user), autonomous (auto-execute when policies pass)' }),
  AEGIS_AGENT_MAX_INVOCATIONS_PER_HOUR: num({ default: 20, desc: 'Per-user/strategy hourly cap on agent turns' }),
  AEGIS_AGENT_SIGNAL_COOLDOWN_MS: num({ default: 300_000, desc: 'Min ms between agent reactions to the same signal type' }),
  AEGIS_AUTO_EXECUTE_MAX_USD: num({ default: 10, desc: 'Max trade size (USD) for autonomous-signal auto-execute. Above this, autonomous mode falls back to advisory + approval.' }),
  AEGIS_TELEGRAM_HANDLER_TIMEOUT_MS: num({ default: 0, desc: 'Telegram update handler timeout. 0 = auto: 5min for qvac/*, 90s otherwise.' }),

  // ── QVAC (Tether local-first AI SDK) ───────────────────────
  // Paths point at GGUF / GGML / ONNX model artifacts on disk. Empty = the
  // capability is unavailable; tools that need it raise QvacUnavailableError
  // and the agent falls back to non-semantic substring lookups.
  QVAC_EMBED_MODEL_PATH: str({ default: '', desc: 'Path to the @qvac/embed-llamacpp GGUF embedding model.' }),
  QVAC_WHISPER_MODEL_PATH: str({ default: '', desc: 'Path to the @qvac/transcription-whispercpp GGML model.' }),
  QVAC_WHISPER_VAD_MODEL_PATH: str({ default: '', desc: 'Optional path to the silero VAD model used by whisper.cpp.' }),
  QVAC_TTS_MODEL_DIR: str({ default: '', desc: 'Directory containing the @qvac/tts-onnx model files (Supertonic/Chatterbox layout).' }),
  QVAC_TTS_VOICE: str({ default: 'F1', desc: 'Default ONNX TTS voice name.' }),
  QVAC_TTS_LANGUAGE: str({ default: 'en', desc: 'Default ONNX TTS language code.' }),
  QVAC_EMBED_DEVICE: str({ default: 'cpu', choices: ['cpu', 'gpu'], desc: 'Embedding inference device.' }),
  QVAC_WHISPER_USE_GPU: bool({ default: false, desc: 'Enable GPU acceleration for whisper.cpp.' }),
  QVAC_ENABLE_RAG: bool({ default: false, desc: 'Enable QVAC-backed semantic memory tools (searchFacts / searchTradeHistory).' }),
  QVAC_ENABLE_VOICE: bool({ default: false, desc: 'Enable QVAC-backed voice transcription + TTS handlers on Telegram/CLI.' }),
  QVAC_BACKFILL: bool({ default: false, desc: 'On startup, embed every AgentFact / AgentToolCall row missing an embedding row.' }),
  QVAC_FFMPEG_PATH: str({ default: '', desc: 'Override path to ffmpeg used for OGG→PCM transcoding. Defaults to ffmpeg-static.' }),

  // QVAC local LLM provider (qvac/local model). Real on-device chat through
  // @qvac/llm-llamacpp; supports tool calling via <tool_call> JSON blocks.
  QVAC_LLM_MODEL_PATH: str({ default: '', desc: 'Path to the @qvac/llm-llamacpp GGUF chat model (Qwen-2.5-Instruct, Llama-3.1-Instruct, Hermes-3, etc.).' }),
  QVAC_LLM_DEVICE: str({ default: 'cpu', choices: ['cpu', 'gpu'], desc: 'LLM inference device.' }),
  QVAC_LLM_GPU_LAYERS: num({ default: 99, desc: 'Layers to offload to GPU when device=gpu.' }),
  QVAC_LLM_CTX_SIZE: num({ default: 8192, desc: 'KV-cache context window. Higher = more history, more RAM.' }),
  QVAC_LLM_TEMP: num({ default: 0.4, desc: 'Sampling temperature for the local LLM (lower = more deterministic for tool calls).' }),
  QVAC_LLM_PREDICT: num({ default: 1024, desc: 'Max tokens to predict per turn.' }),
  QVAC_LLM_MAX_TOOL_STEPS: num({ default: 6, desc: 'Max tool-call iterations per QVAC LLM turn before forcing a plain-text reply.' }),
});

const activeAgentModel = rawEnv.AEGIS_AGENT_MODEL || (rawEnv.QVAC_LLM_MODEL_PATH ? 'qvac/local' : 'codex/default');

const env = Object.freeze({
  ...rawEnv,
  AEGIS_AGENT_MODEL: activeAgentModel,
  AEGIS_TELEGRAM_HANDLER_TIMEOUT_MS: rawEnv.AEGIS_TELEGRAM_HANDLER_TIMEOUT_MS || (activeAgentModel.startsWith('qvac/') ? 300_000 : 90_000),
});

export default env;
