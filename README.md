# AEGIS

**AEGIS is an autonomous onchain trading agent.** Talk to it in natural language; it reasons with Claude or GPT, calls Zerion CLI commands as tools, and every value-moving action runs through a scoped policy engine before signing. Built for the Frontier *"Build an Autonomous Onchain Agent using Zerion CLI"* track.

```text
You:  what's my portfolio?
AEGIS: → getPortfolio()
       Total: $1,847.32 (+1.4% 24h)
        SOL    8.21 ($1,612)
        USDC   234.99
        ...

You:  swap 0.01 SOL to USDC
AEGIS: → getSwapQuote()
       Quote: 0.01 SOL → ~1.94 USDC (Jupiter)
       Approve? [y/N] y
       → executeSwap()  (policies passed: spend-limit, cooldown)
       ✅ Tx: https://solscan.io/tx/4xK2…ZqVk
```

---

## Quickstart

```bash
git clone <this-repo> && cd aegis
cp .env.example .env
# Edit .env — set TELEGRAM_BOT_TOKEN, ZERION_API_KEY
# For the LLM: install Codex CLI (ChatGPT subscription) OR run `pnpm qvac:download` (local).
pnpm install
pnpm db:push          # create the SQLite DB (~/.zerion/aegis.db by default)
pnpm start            # boots Telegram bot + monitors + strategies + agent
# OR
node engine/index.mjs chat   # CLI REPL: talk to the agent locally
```

Requires Node.js ≥ 20.

### LLM access — subscription or local, never API-key

AEGIS deliberately does **not** support API-key billed providers.
Routing the agent through a metered key would charge the wrong party for
autonomy and re-introduce the cloud dependency the QVAC integration is
built to remove. Two paths only:

- **`codex/default`** — drives [Codex CLI](https://developers.openai.com/codex/cli) as the language-model backend for AEGIS; uses your **ChatGPT subscription** (`codex login` once). Default. No keys.
- **`qvac/local`** — fully on-device LLM via the Bare-runtime QVAC sidecar (`@qvac/llm-llamacpp`). Run `pnpm qvac:download` and set `QVAC_LLM_MODEL_PATH`. No keys, no cloud round-trips.

Switch at runtime with `/agent model <id>` (Telegram) or `:model <id>` (CLI REPL).

### Required env

| Variable | What for |
|---|---|
| `TELEGRAM_BOT_TOKEN` | From [@BotFather](https://t.me/BotFather). Required to launch the bot. |
| `ZERION_API_KEY` | From [dashboard.zerion.io](https://dashboard.zerion.io). Powers portfolio + swap quotes. |

### Optional env

| Variable | Default | What for |
|---|---|---|
| `AEGIS_AGENT_MODEL` | `codex/default` | Active model. Switch with `/agent model <id>` at runtime. |
| `CODEX_BIN` | `codex` | Path to the Codex CLI binary; defaults to `$PATH` lookup. |
| `AEGIS_AGENT_AUTONOMY` | `advisory` | `off` / `advisory` (LLM proposes, human approves) / `autonomous`. |
| `AEGIS_AGENT_MAX_INVOCATIONS_PER_HOUR` | `20` | Hard cap on agent turns per user/strategy. |
| `AEGIS_AGENT_SIGNAL_COOLDOWN_MS` | `300000` | Min ms between agent reactions to the same signal type. |
| `HELIUS_API_KEY` | — | Better whale data on Solana. |
| `SOLANA_PRIVATE_KEY` | — | Required for MagicBlock private execution (shield deposit/withdraw). |
| `PRIVACY_MODE` / `PRIVACY_THRESHOLD_USD` / `PRIVACY_TOKENS` | `auto` / `100` / `SOL,USDC` | Routing rules for private execution. |

### QVAC (local-first AI)

AEGIS integrates [Tether QVAC](https://docs.qvac.tether.io) for fully on-device
embeddings, speech-to-text, text-to-speech, and (optionally) the LLM itself —
your trading history, your voice, your keys never leave the machine.

```bash
pnpm qvac:download           # fetch real model artifacts (~1.4 GB total)
pnpm db:push                 # apply the new embedding tables
pnpm qvac:backfill           # embed existing AgentFact / AgentToolCall rows
```

Then add the printed paths to `.env` and flip the feature flags:

| Variable | What for |
|---|---|
| `QVAC_ENABLE_RAG` | Turn on `searchFacts` / `searchTradeHistory` / `summarizeSimilarTrades`. |
| `QVAC_ENABLE_VOICE` | Accept Telegram voice notes; CLI `chat --audio` flag. |
| `QVAC_EMBED_MODEL_PATH` | GGUF embedding model (e.g. `nomic-embed-text-v1.5.Q8_0.gguf`). |
| `QVAC_WHISPER_MODEL_PATH` | GGML whisper.cpp model (e.g. `ggml-tiny.en.bin`). |
| `QVAC_TTS_MODEL_DIR` | Directory containing the ONNX TTS bundle. |
| `QVAC_LLM_MODEL_PATH` | GGUF chat model — enables the `qvac/local` first-class provider. |

When a model is missing, the affected tool raises `QvacUnavailableError`
and the agent falls back to the non-semantic paths (`recallFacts`,
`getHistory`); nothing silently substitutes a cloud API.

**Architecture note:** the QVAC native bindings only run on the [Bare
runtime](https://github.com/holepunchto/bare). AEGIS runs under Node.js
(Prisma, Telegraf, ai-sdk, Solana SDKs all assume Node), so we spawn a
short-lived **Bare sidecar subprocess** that holds the QVAC models and
speaks line-delimited JSON-RPC over stdio. Both halves run real
packages on the runtimes they were built for — no shims, no mocks. See
`engine/qvac/sidecar/`.

```text
You: 🎙️ "buy 50 USDC of SOL like last Tuesday"
AEGIS:
  🎙️ heard (820ms): "buy 50 USDC of SOL like last Tuesday"
  → searchTradeHistory({query: "buy SOL with USDC last Tuesday"})
  → getSwapQuote({fromToken: "USDC", toToken: "SOL", amount: "50"})
  Approve? [tap]
  → executeSwap()
  ✅ Tx: …
```

---

## Studio — local browser UI

Open `AEGIS Studio`, a hand-drawn whiteboard view of every signal,
strategy, agent run, trade, and log line in one localhost-bound page.

```bash
zerion studio                     # launches on http://127.0.0.1:7474
# or directly:
aegis --studio
aegis --studio --studio-port 9000
```

The engine prints a one-time URL with a session token to stderr:
`▶ AEGIS Studio: http://127.0.0.1:7474/?token=...`. The token gates every
`/api` and `/ws` request — same trust model as `prisma studio`. Nothing
binds beyond `127.0.0.1`.

Surfaces (read-only at MVP):

- **Overview** — engine uptime, signal counters, active strategies, KPI
  sticky-notes for trades / agent runs / DCA plans.
- **Live feed** — every event-bus signal as it lands, filtered by type.
- **Agent runs** — `AgentInvocation` table with drill-in to per-tool
  timeline (success, duration, error, input/output).
- **Strategies** — DCA plans, rebalance targets, price alerts.
- **Trades** — `TradeExecution` history with explorer links.
- **Logs** — live pino tail with level + child-logger filter chips.

Studio off by default. With no `--studio` flag the engine never binds the
port. Run `pnpm studio:build` once after pulling fresh changes to build
the React bundle (the published npm package ships with `dist/` already).

## Architecture

```
┌────────────────────────────────────────────────────────┐
│  LLM agent  (Vercel AI SDK 6  ToolLoopAgent)           │  ← engine/agent
│   • system prompt + tool registry                      │
│   • per-user message memory                            │
│   • per-user invocation budget                         │
└──────────────────────┬─────────────────────────────────┘
                       │ tool calls
┌──────────────────────▼─────────────────────────────────┐
│  AEGIS engine                                          │  ← engine/
│   • policies   (spend-limit, cooldown, price-guard,    │
│      time-window, consensus, privacy) — fail-closed    │
│   • strategies (DCA, dip-buyer, take-profit,           │
│      rebalancer, group-consensus, agent)               │
│   • monitors   (price, portfolio, whale, scheduler)    │
│   • execution  (Zerion swap router, MagicBlock         │
│      private rollup)                                   │
└──────────────────────┬─────────────────────────────────┘
                       │ real tx
┌──────────────────────▼─────────────────────────────────┐
│  Zerion CLI base (forked)                              │  ← commands/, utils/
│   wallet keystore (OWS) · swap · bridge · analytics    │
└────────────────────────────────────────────────────────┘
```

Two surfaces talk to the agent:
- **Telegram** — `engine/bot/handlers/chat.mjs:registerChat`. Plain text → agent. `/agent model …`, `/agent autonomy …`, `/agent reset`. Approval flows through inline Approve/Deny keyboards.
- **CLI** — `aegis chat` (REPL) or `aegis chat "<prompt>"` (one-shot). See `commands/chat.js`.

Both surfaces share the same `runAgentTurn()` core in `engine/agent/index.mjs`, the same tool registry, and the same policy gate.

---

## Track requirements — file:line evidence

| Requirement | Where it lives |
|---|---|
| LLM-driven agent (Vercel AI SDK 6) | `engine/agent/index.mjs:runAgentTurn` |
| Tool registry wrapping Zerion CLI | `engine/agent/tools/*.mjs` (25 tools, includes `rememberFact` / `recallFacts` for durable agent memory) |
| Real onchain swap | `engine/agent/tools/swap.mjs:executeSwap` → `engine/execution/executor.mjs:executeTrade` |
| Policy gate (no god-mode) | `engine/policies/engine.mjs:runPolicies` (throws on empty config) |
| No-bypass guarantee | `engine/execution/executor.mjs` (refuses ungated proposals) |
| No-bypass tests | `tests/unit/policies/no-bypass.test.mjs`, `tests/unit/agent/no-bypass.test.mjs` |
| Tool contract test | `tests/unit/agent/tool-contract.test.mjs` |
| Human-in-the-loop approval | `engine/agent/tools/swap.mjs` (`needsApproval: true`) + `engine/bot/handlers/chat.mjs` (Approve/Deny callback) |
| Multi-model (OpenAI + Anthropic) | `engine/agent/index.mjs:resolveModel`, runtime switch via `/agent model` |
| Autonomous signal reactions | `engine/strategies/agent.mjs:AgentStrategy` |
| MagicBlock private execution | `engine/execution/private-executor.mjs` + `engine/lib/magicblock/client.mjs` |

---

## Multi-model

```bash
AEGIS_AGENT_MODEL=openai/gpt-5 pnpm start
AEGIS_AGENT_MODEL=anthropic/claude-sonnet-4.5 pnpm start
```

Or live-switch in the bot:

```
/agent model openai/gpt-4.1-mini
/agent model anthropic/claude-opus-4.7
```

Available: `openai/gpt-5`, `openai/gpt-4.1-mini`, `anthropic/claude-sonnet-4.5`, `anthropic/claude-opus-4.7`. Same prompt, same tools, same policy gate across providers.

---

## Tool surface (21 tools)

| Group | Tools |
|---|---|
| Portfolio (read) | `getPortfolio`, `getPositions`, `getPnl`, `getHistory` |
| Market (read) | `getTokenPrice`, `searchToken`, `listChains` |
| Swap | `getSwapQuote`, **`executeSwap`** *(approval + policy gate)* |
| DCA | **`createDCAPlan`** *(approval)*, `listDCAPlans`, `pauseDCAPlan`, `cancelDCAPlan` |
| Policy (read) | `listAvailablePolicies`, `showActivePolicies`, `getDefaultPoliciesForStrategy` |
| Shield (MagicBlock) | `getShieldBalance`, **`depositToShield`** *(approval)*, **`withdrawFromShield`** *(approval)* |
| Wallet (read) | `listWallets`, `getWalletAddresses` |

Destructive credential ops (wallet create/delete/import, agent token create/revoke) are intentionally human-only and not exposed to the LLM.

---

## Test surface

```bash
pnpm test:unit
```

Covers:
- CLI router behaviour
- Policy no-bypass guarantees — `MissingPolicyConfigError` on empty config, executor refuses proposals without `policyResult`
- Agent tool contract — every tool has description / inputSchema / execute, value-moving tools have `needsApproval: true`
- Agent no-bypass — proves the LLM cannot skip the policy gate even when calling the tool's `execute()` directly

---

## Notes

- `AEGIS_AGENT_AUTONOMY=off` disables autonomous signal reactions; chat still works.
- Built on the forked Zerion CLI in this repo. The Zerion-only commands (`zerion swap`, `zerion portfolio`, `zerion wallet …`) still work; the agent is additive.
- MagicBlock devnet validator: `FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA`.

---

## Demo

A six-minute end-to-end Telegram walkthrough (portfolio query → swap quote → approval → real swap → DCA plan → live model switch → policy denial) is recorded at: *(link inserted after capture)*.

Solscan tx hashes for the demo run are listed in `TRACKS.md`.

---

## License

MIT — see `LICENSE`.
