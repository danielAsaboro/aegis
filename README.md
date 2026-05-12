# AEGIS

**AEGIS is a self-provisioning autonomous onchain trading agent.** Its operator-facing interface is Telegram plus the long-running runtime: you start AEGIS once, send it messages or let scheduled signals drive it, and every value-moving action runs through a scoped, fail-closed policy engine before signing. On first boot it creates its own wallet — no manual setup needed.

Built for the Frontier *"Build an Autonomous Onchain Agent using Zerion CLI"* track.

**Website:** https://tryaegis.xyz

```text
Telegram: "what's my portfolio?"
AEGIS:    → getPortfolio()
          Total: $1,847.32 (+1.4% 24h)
           SOL    8.21 ($1,612)
           USDC   234.99

Telegram: "swap 0.01 SOL to USDC"
AEGIS:    → getSwapQuote()
          Quote: 0.01 SOL → ~1.94 USDC (Zerion route)
          Approve? [Telegram button]
          → executeSwap()  (policies passed: spend-limit, cooldown)
          ✅ Tx: https://explorer.solana.com/tx/4xK2…ZqVk

Telegram: "set a DCA — buy $5 SOL every 30 minutes"
AEGIS:    → commitMission() → createDCAPlan()
          ✅ DCA scheduled. Policy cap: $25/tick, $100/day.
```

---

## Judge Path

Use this if you are evaluating the submission quickly:

```bash
cp .env.example .env.local
# set TELEGRAM_BOT_TOKEN, ZERION_API_KEY, SOLANA_PRIVATE_KEY
pnpm install
pnpm db:push
pnpm start
```

Then in Telegram:

```text
swap 0.01 SOL to USDC
```

Expected path:

```text
Telegram message -> Zerion quote -> scoped approval/policy gate -> signed execution -> explorer proof
```

- Mainnet Zerion swap proof: `https://explorer.solana.com/tx/5aK9pZ9KCBhKawgcMdFGmS5W8rQbRoQ1utiUPSA7tHKF2f1d6zxq1gNRjWpqwMEdn4oA2JBJ5yGa5bqyXaZ16Ko6`
- Readiness check: `pnpm judge-status` (add `-- --live` to probe Zerion API connectivity)
- Policy proof without funds: `pnpm judge-trace`
- Internal harsh checklist: [docs/frontier-checklist.mdx](/Volumes/Development/solana/hackathon/frontier/zerion-magicblock/aegis/docs/frontier-checklist.mdx)

---

## Quickstart

```bash
git clone <this-repo> && cd aegis
cp .env.example .env.local
# Edit .env.local — set TELEGRAM_BOT_TOKEN, ZERION_API_KEY, SOLANA_PRIVATE_KEY
pnpm install
pnpm db:push
pnpm start                      # bot + monitors + strategies, self-provisions wallet on first run
```

Requires Node.js ≥ 20.

**First boot is zero-touch.** If the wallet named in `DEFAULT_WALLET` (default: `main`) doesn't exist in the OWS keystore, the engine imports it from `SOLANA_PRIVATE_KEY` automatically — or generates a fresh keypair if none is set. The wallet persists across restarts; provisioning only runs once.

### LLM access — subscription or local, never an API key

AEGIS deliberately rejects API-key billed providers. Routing the agent through a metered key charges the wrong party and reintroduces the cloud dependency the QVAC integration removes. Two paths only:

- **`codex/default`** — drives [Codex CLI](https://developers.openai.com/codex/cli) as the language-model backend; uses your **ChatGPT subscription** (`codex login` once). Fallback when local QVAC is not configured. No keys.
- **`qvac/local`** — fully on-device LLM via the Bare-runtime QVAC sidecar (`@qvac/llm-llamacpp`). Run `pnpm qvac:download` and set `QVAC_LLM_MODEL_PATH`. No keys, no cloud.

Switch at runtime with `/agent model <id>` in Telegram.

### Required env

| Variable | What for |
|---|---|
| `TELEGRAM_BOT_TOKEN` | From [@BotFather](https://t.me/BotFather). Required to launch the bot. |
| `ZERION_API_KEY` | From [dashboard.zerion.io](https://dashboard.zerion.io). Powers portfolio + swap quotes. |
| `SOLANA_PRIVATE_KEY` | JSON byte-array `[b0,b1,…,b63]` or base58 secret key. Used for MagicBlock private execution and auto-provisioned as the `main` wallet on first boot. |

### Optional env

| Variable | Default | What for |
|---|---|---|
| `AEGIS_AGENT_MODEL` | auto (`qvac/local` when configured, else `codex/default`) | Active LLM. Switch with `/agent model` at runtime. |
| `AEGIS_AGENT_AUTONOMY` | `advisory` | `off` / `advisory` (LLM proposes, human approves) / `autonomous`. |
| `AEGIS_AGENT_MAX_INVOCATIONS_PER_HOUR` | `20` | Hard cap on agent turns per user/strategy. |
| `DEFAULT_WALLET` | `main` | OWS keystore wallet name. Auto-created on first boot. |
| `PRIVACY_MODE` / `PRIVACY_THRESHOLD_USD` / `PRIVACY_TOKENS` | `auto` / `100` / `SOL,USDC` | Routing rules for MagicBlock private execution. |
| `HELIUS_API_KEY` | — | Richer whale data on Solana. |

---

## Architecture

```
┌────────────────────────────────────────────────────────┐
│  LLM agent  (Vercel AI SDK 6  ToolLoopAgent)           │  ← engine/agent
│   • system prompt + tool registry (34 tools)           │
│   • per-user message memory  (Prisma)                  │
│   • per-user invocation budget                         │
└──────────────────────┬─────────────────────────────────┘
                       │ tool calls
┌──────────────────────▼─────────────────────────────────┐
│  AEGIS engine                                          │  ← engine/
│   • policies   (spend-limit · cooldown · price-guard   │
│                 time-window · consensus · privacy)     │
│   • strategies (DCA · dip-buyer · take-profit ·        │
│                 rebalancer · group-consensus · agent)  │
│   • monitors   (price · portfolio · whale · scheduler) │
│   • execution  (Zerion swap router · MagicBlock        │
│                 private ephemeral rollup)              │
└──────────────────────┬─────────────────────────────────┘
                       │ signed transactions
┌──────────────────────▼─────────────────────────────────┐
│  Zerion CLI  (extended)                                │  ← cli/
│   wallet keystore (OWS) · swap · bridge · analytics   │
└────────────────────────────────────────────────────────┘
```

Two long-running paths share the same `runAgentTurn()` core, tool registry, and policy gate:

- **Telegram** — `engine/bot/handlers/chat.mjs`. Plain text → agent. Inline Approve/Deny keyboards for every value-moving action. `/agent model`, `/agent autonomy`, `/agent reset`.
- **Daemon / scheduler** — `engine/daemon-supervisor.mjs` plus `engine/runtime/message-runtime.mjs`. Scheduled jobs and attached clients enqueue the same message envelope shape the Telegram surface uses.

---

## Policy engine

Every trade, DCA tick, and shield deposit goes through `engine/policies/engine.mjs:runPolicies` before a transaction is ever built. The gate is **fail-closed** — empty policy config throws `MissingPolicyConfigError`, proposals without a passing `policyResult` are refused at the executor, and there is no bypass flag.

Six built-in policies:

| Policy | What it checks |
|---|---|
| `spend-limit` | Per-tick, daily, and total USD caps per strategy |
| `cooldown` | Minimum interval between trades per strategy |
| `time-window` | Restrict execution to configured UTC hours |
| `price-guard` | Max slippage and absolute price bounds |
| `consensus` | Require N-of-M Telegram votes for large trades |
| `privacy` | Route trades above threshold through MagicBlock |

Run `aegis judge-trace` for a single-screen proof of every policy decision path (no money moved).

---

## Tool surface (34 tools)

Canonical list: `engine/agent/tools/index.mjs:allTools`.

| Group | Tools |
|---|---|
| Portfolio (read) | `getPortfolio`, `getPositions`, `getPnl`, `getHistory` |
| Market (read) | `getTokenPrice`, `searchToken`, `listChains` |
| Swap | `getSwapQuote`, **`executeSwap`** *(approval + policy gate)* |
| DCA | **`createDCAPlan`** *(approval)*, `listDCAPlans`, `pauseDCAPlan`, `cancelDCAPlan` |
| Policy (read) | `listAvailablePolicies`, `showActivePolicies`, `getDefaultPoliciesForStrategy` |
| Shield (MagicBlock) | `getShieldBalance`, **`depositToShield`** *(approval)*, **`withdrawFromShield`** *(approval)* |
| Wallet (read) | `listWallets`, `getWalletAddresses` |
| Agent memory | `rememberFact`, `recallFacts`, `forgetFact`, `listFacts` |
| QVAC RAG | `searchFacts`, `searchTradeHistory`, `summarizeSimilarTrades` |
| Missions | **`commitMission`** *(approval)*, `listMissions`, `getMissionStatus`, `pauseMission`, `resumeMission`, `cancelMission` |

Destructive credential ops (wallet create/import, agent token create/revoke) are intentionally human-only and not exposed to the LLM.

---

## MagicBlock private execution

The privacy policy can route supported shield actions through MagicBlock's ephemeral rollup. Cross-token private swaps are intentionally refused today; the supported private path is same-token shielding.

```text
Implemented target flow: deposit → delegateSpl (ephemeral rollup) → private transfer → withdraw
Verified today: deposit → delegateSpl with `private: true`
Blocked today: private transfer + withdraw cycle, awaiting MagicBlock SDK guidance on `DelegationRecordInvalidAccountOwner`
```

The `deposit()` path handles native SOL automatically — it wraps SOL to WSOL, creates the associated token account idempotently, then delegates to the rollup via the SDK's `delegateSpl`. No manual account setup required.

Devnet validator: `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57` (resolved live from `getIdentity` on `https://devnet.magicblock.app`).

---

## Testing

```bash
pnpm test:unit                  # deterministic unit suite — policy gate, agent tools, missions, strategies
pnpm test:e2e                   # 46 e2e tests — requires ZERION_API_KEY + SOLANA_PRIVATE_KEY + devnet SOL
node --env-file=.env.local --test tests/e2e/solana-swap-surfpool.test.mjs  # executable Zerion swap tx signed + broadcast locally when quote is not blocked
AEGIS_RUN_QVAC_LIVE_TESTS=1 pnpm test:qvac  # optional live local-GGUF probe
```

### End-to-end coverage

| Suite | What it exercises |
|---|---|
| `aegis.e2e` | Engine boot, policy approval, DCA storage, consensus voting, shield store |
| `dca-strategy` | Plan lifecycle, scheduler sync, policy gate, Prisma persistence across restart |
| `group-consensus` | N-of-M vote accumulation, expiry, cross-restart persistence |
| `privacy-trading` | Privacy routing, real MagicBlock deposit (WSOL wrap → delegate) |
| `signal-automation` | Alert persistence, event bus, DipBuyer/TakeProfit/Rebalancer strategy evaluation |
| `minimal-real` | Live Zerion API (64 chains), Telegram bot, Solana devnet, MagicBlock connectivity |
| `working-wallet` | Keypair, balance, env coverage |
| `solana-swap-surfpool` | Zerion SOL→USDC quote inspection; signs and broadcasts only when Zerion returns an executable Solana tx |

### Local Solana swap simulation (surfpool)

AEGIS now ships a first-class local mode for Solana execution testing:

1. Starts or reuses `surfpool` on `127.0.0.1:8899`
2. Creates an isolated local OWS/config profile under `.surfpool/aegis-local/`
3. Imports `SOLANA_PRIVATE_KEY` as a disposable local Zerion wallet
4. Creates a fresh Solana-only policy and agent token for that local wallet
5. Fetches a live Zerion quote (SOL→USDC)
6. If Zerion returns an executable transaction, signs it and broadcasts it to surfpool instead of mainnet

This mode keeps **Zerion quotes live** while forcing **Solana broadcast local** for executable quotes, so you can test the real swap path without spending mainnet funds.

```bash
pnpm local:bootstrap
pnpm local:swap
pnpm local:daemon
pnpm local:agent -- "swap 0.001 SOL to USDC on Solana"
pnpm test:e2e:surfpool-live
```

Notes:

- Local mode does not touch your real `~/.zerion` profile.
- It uses a repo-local isolated `HOME` and `DATA_DIR`.
- `local:agent` sends a real inbound message over the daemon socket, so you
  can test the normal message-driven runtime instead of a one-shot helper path.
- When a local QVAC GGUF exists in `~/.cache/aegis/qvac/`, local mode uses
  `qvac/local` automatically instead of `codex/default`.
- The local swap path still depends on Zerion returning a live executable quote for the configured wallet address.
- If Zerion returns only a blocked quote, the command reports that honestly instead of substituting a self-transfer.

---

## Track requirements — evidence

| Requirement | Where it lives |
|---|---|
| LLM-driven agent (Vercel AI SDK 6) | `engine/agent/index.mjs:runAgentTurn` |
| Tool registry wrapping Zerion CLI | `engine/agent/tools/*.mjs` — 34 tools |
| Real onchain swap | `engine/agent/tools/swap.mjs:executeSwap` → `engine/execution/executor.mjs:executeTrade` |
| Policy gate (fail-closed) | `engine/policies/engine.mjs:runPolicies` — throws on empty config |
| No-bypass guarantee | `engine/execution/executor.mjs` — refuses proposals without passing `policyResult` |
| No-bypass tests | `tests/unit/policies/no-bypass.test.mjs`, `tests/unit/agent/no-bypass.test.mjs` |
| Tool contract test | `tests/unit/agent/tool-contract.test.mjs` |
| Human-in-the-loop approval | `engine/agent/tools/swap.mjs` (`needsApproval: true`) + Telegram inline keyboards |
| Autonomous signal reactions | `engine/strategies/agent.mjs:AgentStrategy` |
| MagicBlock private execution | `engine/execution/private-executor.mjs` + `engine/lib/magicblock/client.mjs` |
| Self-provisioning wallet | `engine/index.mjs:main` — imports or generates wallet on first boot |

---

## Multi-model

```bash
AEGIS_AGENT_MODEL=codex/default node engine/index.mjs
AEGIS_AGENT_MODEL=qvac/local    node engine/index.mjs
```

Or live-switch without restarting:

```
/agent model codex/default
/agent model qvac/local
```

Same prompt, same tools, same policy gate across providers. API-key billed routes (`openai/*`, `anthropic/*`) are explicitly rejected — see `engine/agent/resolve-model.mjs`.

---

## QVAC (local-first AI) — Tether QVAC side prize

AEGIS integrates [Tether QVAC](https://docs.qvac.tether.io) for fully on-device embeddings, speech-to-text, text-to-speech, and the LLM itself — your trading history, voice, and keys never leave the machine.

```bash
pnpm qvac:download     # fetch model artifacts (~1.4 GB)
pnpm db:push           # apply embedding tables
pnpm qvac:backfill     # embed existing AgentFact / AgentToolCall rows
```

| Variable | What for |
|---|---|
| `QVAC_ENABLE_RAG` | Enable `searchFacts` / `searchTradeHistory` / `summarizeSimilarTrades` |
| `QVAC_ENABLE_VOICE` | Accept Telegram voice notes; CLI `chat --audio` flag |
| `QVAC_EMBED_MODEL_PATH` | GGUF embedding model |
| `QVAC_WHISPER_MODEL_PATH` | GGML whisper.cpp model |
| `QVAC_TTS_MODEL_DIR` | ONNX TTS bundle directory |
| `QVAC_LLM_MODEL_PATH` | GGUF chat model — enables `qvac/local` provider |

When a model is missing, the affected tool raises `QvacUnavailableError` and the agent falls back gracefully. Nothing silently substitutes a cloud API.

**Architecture note:** QVAC native bindings run on the [Bare runtime](https://github.com/holepunchto/bare). AEGIS runs under Node.js, so we spawn a short-lived Bare sidecar subprocess holding the QVAC models and speaking line-delimited JSON-RPC over stdio. Both halves run real packages on the runtimes they were built for — no shims. See `engine/qvac/sidecar/`.

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

```bash
node engine/index.mjs --studio            # http://127.0.0.1:7474
node engine/index.mjs --studio --studio-port 9000
```

The engine prints a one-time URL with a session token to stderr. Token gates every `/api` and `/ws` request — nothing binds beyond `127.0.0.1`.

Surfaces: Overview · Live feed · Agent runs · Strategies · Trades · Logs.

---

## Demo

End-to-end Telegram walkthrough (portfolio → swap → approval → DCA → model switch → policy denial):

<https://www.youtube.com/playlist?list=PLeERy8YL4mpRKIQyVis1cI1L9gk8j63Oi>

Solana Explorer tx hashes for the demo run are listed in `TRACKS.md`.

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
