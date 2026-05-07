# AEGIS as an MCP server (Codex CLI / Claude Code / Cursor)

AEGIS exposes its full agent tool catalog over the Model Context Protocol.
Connect it to any MCP host and drive AEGIS using *that* host's subscription
(ChatGPT Plus/Pro for Codex, Claude Pro/Max for Claude Code, ...). No
in-house OAuth, no API key required for the LLM side.

## Tool surface

The 25 tools registered are the same set the in-process agent uses (see
`engine/agent/tools/index.mjs`):

- Portfolio: `getPortfolio`, `getPositions`, `getPnl`, `getHistory`
- Market: `getTokenPrice`, `searchToken`, `listChains`
- Swap: `getSwapQuote`, `executeSwap`
- DCA: `createDCAPlan`, `listDCAPlans`, `pauseDCAPlan`, `cancelDCAPlan`
- Policy: `listAvailablePolicies`, `showActivePolicies`, `getDefaultPoliciesForStrategy`
- Shield (MagicBlock): `getShieldBalance`, `depositToShield`, `withdrawFromShield`
- Wallet (read-only): `listWallets`, `getWalletAddresses`
- Facts: `rememberFact`, `recallFacts`, `forgetFact`, `listFacts`

Write tools (`executeSwap`, `depositToShield`, `withdrawFromShield`,
DCA plan mutators) still run through the AEGIS policy engine inside
`execute()`. The MCP host's own approval UI is an extra gate, not a
replacement for AEGIS policies.

## Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.aegis]
command = "node"
args = ["/Volumes/Development/solana/hackathon/frontier/zerion-magicblock/engine/index.mjs", "mcp"]

[mcp_servers.aegis.env]
ZERION_API_KEY = "zk_dev_..."
DEFAULT_WALLET = "main"
DEFAULT_CHAIN  = "solana"
DATA_DIR       = "/Users/<you>/.zerion/aegis"
```

Then in the Codex TUI:

```
/mcp
```

You should see `aegis` listed with all 25 tools. Try:

> show my portfolio

Codex will call `getPortfolio` against the configured wallet.

### Alternative: register via the CLI

```
codex mcp add aegis -- node /absolute/path/to/engine/index.mjs mcp
```

This writes the same `[mcp_servers.aegis]` block to `~/.codex/config.toml`.
Add the env block manually afterward (or pass `--env KEY=VAL` flags).

## Claude Code

Add to `~/.claude.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "aegis": {
      "command": "node",
      "args": ["/Volumes/Development/solana/hackathon/frontier/zerion-magicblock/engine/index.mjs", "mcp"],
      "env": {
        "ZERION_API_KEY": "zk_dev_...",
        "DEFAULT_WALLET": "main",
        "DEFAULT_CHAIN": "solana"
      }
    }
  }
}
```

## Cursor

Settings → MCP → Add new MCP server. Use the same command + args + env as
above.

## Local debugging

Run the server directly and pipe MCP JSON-RPC messages:

```bash
cat <<'EOF' | npm run mcp
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoketest","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
EOF
```

Logs go to **stderr** (the JSON-RPC stream owns stdout). The MCP server
sets `AEGIS_LOG_STDERR=1` automatically; if you launch it through some
other entry point, set that env var manually so pino doesn't corrupt the
protocol stream.

## Reverse direction: AEGIS-as-Codex-client (no API keys)

The MCP wiring above puts AEGIS *under* Codex — you drive AEGIS from inside
the Codex TUI. The reverse setup runs AEGIS's own CLI / REPL but pipes every
agent turn through your local `codex` binary, which authenticates against
your ChatGPT subscription. **No `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`
required.**

How it works:

```
aegis chat "what's my portfolio?"
  └─ runAgentTurn → CodexProvider
       └─ MCP STDIO client → spawns `codex mcp-server`
            └─ codex(prompt, base-instructions=<aegis system>, config={
                 mcp_servers.aegis = { node engine/index.mjs mcp }
               })
                 └─ Codex spawns the AEGIS MCP server (same one as above)
                      └─ Codex calls AEGIS tools (getPortfolio, executeSwap, …)
```

ChatGPT subscription drives the reasoning, AEGIS keeps its full tool
catalog, and write tools (`executeSwap`, `depositToShield`, …) still run
through `runPolicies()` because that gate lives inside each tool's
`execute()`.

### One-time setup

```bash
codex login          # if you haven't already
```

### Use it

```bash
AEGIS_AGENT_MODEL=codex/default node engine/index.mjs chat "what chains do you support?"
```

Or in `.env`:

```
AEGIS_AGENT_MODEL=codex/default
# OPENAI_API_KEY / ANTHROPIC_API_KEY can be left unset
```

`codex/default` lets the Codex CLI pick whatever model your auth allows
(important: ChatGPT-account auth rejects explicit `gpt-5` and similar — let
Codex decide unless you have a reason to override).

To pin a specific model: `AEGIS_AGENT_MODEL=codex/<model>` (e.g.
`codex/gpt-5.2-codex`).

Optional knobs:

- `CODEX_BIN` — path to the codex binary (default: PATH lookup).
- `CODEX_DEFAULT_MODEL` — overrides the model passed when `AEGIS_AGENT_MODEL`
  is `codex/default`. Leave blank to let Codex pick.

### Trade-offs

- **No streaming.** Codex MCP returns the final assistant text as one blob,
  so the REPL prints it at the end of the turn instead of token-by-token.
- **Empty tool telemetry.** Codex executes AEGIS tools internally; AEGIS's
  `AgentToolCall` rows are blank for codex-driven turns. The AEGIS MCP
  server still logs each call to stderr (`[mcp] server connected (… tools)`)
  so you can see them go by.
- **Conversation continuity** is via Codex's `threadId`, kept in-memory for
  the lifetime of the AEGIS process. Restart AEGIS → new thread.

### Adding more subscription brains

`engine/agent/providers/index.mjs` is a registry. To add a Claude Code,
Gemini CLI, or other MCP-capable subscription brain, drop a sibling file
in `engine/agent/providers/` that implements
`{ init, invoke({ system, prompt, threadId, modelOverride }), shutdown }`
and register it in the `PROVIDERS` map. The router parses
`<provider>/<model>` and dispatches automatically.

## Why MCP instead of in-house OAuth

Earlier versions of AEGIS implemented OAuth2 PKCE flows for Claude Pro and
ChatGPT Plus directly. Both providers actively throttle/block third-party
clients on those flows (Claude returns 429 with no `Retry-After`; OpenAI
doesn't even expose an OAuth-app registration UI for end users). MCP
sidesteps the entire problem: the MCP host owns the subscription auth, and
AEGIS just exposes tools.
