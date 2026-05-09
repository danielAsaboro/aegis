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
|---------|-------------|---------|
| `zerion sign-message <message> --chain <chain>` | Sign EIP-191 (EVM) or raw (Solana) message | `zerion sign-message "Login to dApp" --chain ethereum` |
| `zerion sign-message <message> --encoding hex` | Treat message as hex bytes | `zerion sign-message 0xdeadbeef --encoding hex --chain ethereum` |
| `zerion sign-typed-data --data '<json>'` | Sign EIP-712 typed data (EVM only) | `zerion sign-typed-data --data "$(cat permit.json)"` |
| `zerion sign-typed-data --file <path>` | Read EIP-712 typed data from file | `zerion sign-typed-data --file permit.json` |
| `cat typed.json \| zerion sign-typed-data` | Read EIP-712 typed data from stdin | `cat permit.json \| zerion sign-typed-data` |

### Agent Tokens

Scoped API tokens for unattended trading. Token auto-saves to config; required for `swap`, `bridge`, `send`.

| Command | Description | Example |
|---------|-------------|---------|
| `zerion agent create-token --name <bot> --wallet <wallet>` | Create scoped token | `zerion agent create-token --name dca-bot --wallet trading-bot` |
| `zerion agent list-tokens` | List active agent tokens | `zerion agent list-tokens` |
| `zerion agent use-token --wallet <wallet>` | Switch active token by wallet | `zerion agent use-token --wallet trading-bot` |
| `zerion agent revoke-token --name <bot>` | Revoke a token | `zerion agent revoke-token --name dca-bot` |

### Agent Policies

Restrict what an agent token can do — chains, expiry, transfers, approvals, allowlists.

| Command | Description | Example |
|---------|-------------|---------|
| `zerion agent create-policy --name <policy>` | Create security policy (flags below) | `zerion agent create-policy --name safe-base --chains base --expires 24h --deny-transfers` |
| `zerion agent list-policies` | List all policies | `zerion agent list-policies` |
| `zerion agent show-policy <id>` | Show policy details | `zerion agent show-policy safe-base` |
| `zerion agent delete-policy <id>` | Delete a policy | `zerion agent delete-policy safe-base` |

Policy flags:

| Flag | Description |
|------|-------------|
| `--chains <list>` | Restrict to specific chains (comma-separated) |
| `--expires <duration>` | Token expiry (e.g. `24h`, `7d`) |
| `--deny-transfers` | Block raw ETH/native transfers |
| `--deny-approvals` | Block ERC-20 approval calls |
| `--allowlist <addresses>` | Only allow listed contract/wallet addresses |

### Watchlist

Track wallets by name without exposing addresses in commands.

| Command | Description | Example |
|---------|-------------|---------|
| `zerion watch <address> --name <label>` | Add wallet to watchlist | `zerion watch 0xFe89Cc7Abb2C4183683Ab71653c4cCd1b9cC194e --name ens-dao` |
| `zerion watch list` | List watched wallets | `zerion watch list` |
| `zerion watch remove <name>` | Remove from watchlist | `zerion watch remove ens-dao` |
| `zerion analyze <name>` | Analyze a watched wallet by name | `zerion analyze ens-dao` |

### Setup

| Command | Description | Example |
|---------|-------------|---------|
| `zerion init` | One-shot onboarding — install CLI globally, configure API key, install agent skills | `zerion init` |
| `zerion init -y --browser` | Non-interactive init that opens dashboard.zerion.io for the API key | `npx -y zerion-cli init -y --browser` |
| `zerion setup skills` | Install Zerion agent skills into detected coding agents | `zerion setup skills` |
| `zerion setup skills --agent claude-code` | Install into a specific agent | `zerion setup skills --agent claude-code` |

### Configuration

| Command | Description | Example |
|---------|-------------|---------|
| `zerion config set <key> <value>` | Set config (`apiKey`, `defaultWallet`, `defaultChain`, `slippage`) | `zerion config set defaultChain base` |
| `zerion config unset <key>` | Remove a config value (resets to default) | `zerion config unset defaultChain` |
| `zerion config list` | Show current configuration | `zerion config list` |

## Global Flags

| Flag | Description |
|------|-------------|
| `--wallet <name>` | Source wallet (default: from config) |
| `--address <addr\|ens>` | Use raw address or ENS name |
| `--watch <name>` | Use watched wallet by name |
| `--chain <chain>` | Chain for analysis commands (default: `ethereum`) |
| `--to-wallet <name>` | Destination wallet for `bridge` (Solana ↔ EVM) |
| `--to-address <addr>` | Destination address for `bridge` (must match destination-chain format) |
| `--positions all\|simple\|defi` | Filter positions type |
| `--limit <n>` | Limit results (default: 20 for list ops) |
| `--offset <n>` | Skip first N results (pagination) |
| `--search <query>` | Filter wallets by name or address |
| `--slippage <percent>` | Slippage tolerance (default: 2%) |
| `--x402` | Pay-per-call on Base or Solana (analytics only) |
| `--mpp` | Pay-per-call on Tempo (analytics only) |
| `--json` | JSON output (default) |
| `--pretty` | Human-readable output |
| `--quiet` | Minimal output |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZERION_API_KEY` | API key (get at [dashboard.zerion.io](https://dashboard.zerion.io)) |
| `WALLET_PRIVATE_KEY` | Pay-per-call key. `0x...` → x402 on Base; `base58` → x402 on Solana; `0x...` also works for MPP |
| `EVM_PRIVATE_KEY` | EVM key for x402 on Base (overrides `WALLET_PRIVATE_KEY` for EVM) |
| `SOLANA_PRIVATE_KEY` | Solana key for x402 on Solana (overrides `WALLET_PRIVATE_KEY` for Solana) |
| `TEMPO_PRIVATE_KEY` | EVM key for MPP on Tempo (overrides `WALLET_PRIVATE_KEY` for MPP) |
| `ZERION_X402` | `true` enables x402 globally (analytics only) |
| `ZERION_X402_PREFER_SOLANA` | `true` prefers Solana over Base when both keys set |
| `ZERION_MPP` | `true` enables MPP globally (analytics only) |
| `SOLANA_RPC_URL` | Custom Solana RPC endpoint |
| `ETH_RPC_URL` | Custom Ethereum RPC endpoint (used for ENS resolution) |

## Output

All commands emit JSON to stdout (default) for agent compatibility. Errors emit JSON to stderr with a `code` field for programmatic handling. Use `--pretty` for human-readable output, `--quiet` for minimal.

## Failure Modes

The CLI handles:

- missing or invalid API key
- invalid wallet address or ENS resolution failure
- unsupported chain filter
- empty wallets / no positions
- rate limits (HTTP 429)
- upstream timeout or temporary unavailability

All errors are emitted as structured JSON on stderr with a `code` field.

## Development

```bash
npm install
npm test                  # unit tests (fast, offline)
npm run test:integration  # live API tests (requires ZERION_API_KEY, runs serially to avoid rate limits)
npm run test:all          # both
node ./cli/zerion.js --help
```

### Contribution guidelines

- Keep examples copy-pasteable.
- Prefer official Zerion naming and documented behavior.
- Document real gaps instead of inventing interfaces.
- Preserve JSON-first CLI output for agent compatibility.

### Releasing to npm

This repo uses [release-please](https://github.com/googleapis/release-please) for automated versioning and publishing.

**Commit conventions** — use [Conventional Commits](https://www.conventionalcommits.org/) prefixes:

- `feat:` — new feature → minor version bump
- `fix:` — bug fix → patch version bump
- `feat!:` or `fix!:` — breaking change → major version bump
- `docs:`, `chore:`, `test:` — no release triggered

**Release flow:**

1. Merge `feat:` or `fix:` commits to `main`
2. release-please opens/updates a release PR (`chore(main): release X.Y.Z`) with version bump and CHANGELOG
3. Merge the release PR when ready to ship
4. GitHub Release is created automatically → triggers `npm publish`

To force a specific version, add `Release-As: 2.0.0` in a commit message body.

**CI setup:**

- `NPM_TOKEN` repo secret is required for npm publish (use a granular access token)
- `.release-please-manifest.json` tracks the current version
- `.github/workflows/release-please.yml` handles release PR creation and npm publish
- `.github/workflows/test.yml` runs tests on PRs and pushes to main
## License

MIT — see `LICENSE`.
