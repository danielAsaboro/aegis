---
name: trading-tool-orchestration
description: AEGIS playbook for orchestrating value-moving operations (swap / buy / sell, DCA, rebalance, price alert + auto-buy, MagicBlock shield deposit/withdraw, persisted preferences) and semantic memory recall in the correct order. Load whenever the user wants AEGIS to actually DO something with funds — buy/swap/sell tokens, set up a recurring or threshold-based purchase, move balance to/from the private vault, rebalance allocations, set a price alert that places a trade, or persist a preference — even when phrased casually ("buy some SOL", "the usual", "weekly buy", "park this in private", "set up DCA for tokens I hold", "remember I prefer USDC"). ALWAYS load before DCA setup, rebalance setup, or any request that depends on current holdings/balances. ALSO load when the user references prior activity fuzzily ("like last Tuesday", "the one that got denied", "trades similar to X", "show me trades I've done") so semantic memory (searchTradeHistory, summarizeSimilarTrades, searchFacts) is consulted before any new proposal. SKIP only for conceptual explanations, key/backup how-tos, or model/config questions that do not need wallet state.
---

# Trading Tool Orchestration

## Why this skill exists

AEGIS has ~25 tools spanning portfolio reads, market data, swap execution,
DCA plans, shielded balances, semantic memory, and a fail-closed policy
engine. Calling them in the wrong order — executing before quoting,
proposing without checking memory, claiming success before a tx hash
returns — is how an agent loses user trust and breaks the policy
contract. This skill encodes the right sequence for the common flows.

The base system prompt says *what* the rules are. This skill says *how*
to compose tools so those rules hold automatically.

## When to load this skill

Pull this in via `loadSkill({ name: "trading-tool-orchestration" })`
when the user request is value-relevant:

- Any direct trade ("swap 0.5 SOL to USDC", "buy $50 of SOL")
- Anything fuzzy that *implies* a trade ("park this in private", "the usual buy", "rebalance to 60/40")
- Any reference to historical activity that should inform action ("last Tuesday", "the one that got denied", "what I usually do")
- Setup of recurring or automated activity (DCA, alerts that buy, rebalance targets)
- Shield deposits / withdrawals
- Fact persistence ("remember that I prefer USDC", "forget my old DCA size")

Skip the skill for conceptual requests ("what is DCA?", key backup
how-tos, model/config questions) that do not need wallet state.

Do not ask the user to manually list tokens, chains, balances, or "what
they hold" when a tool can fetch it. The agent has read-only wallet tools;
use them.

## The five flows

### 1. Direct trade — `executeSwap`

The canonical chain:

1. **Resolve ambiguous size first.** If the user said "a bit" or "some",
   ask one short clarifying question. Don't guess.
2. **Check memory if the user referenced precedent.** Phrases like "the
   usual", "like last time", "what I always buy" → call
   `searchTradeHistory` (semantic, on-device) before quoting. If you find
   a clear pattern, mirror it; if `ragAvailable: false`, fall back to
   `getHistory` and tell the user RAG is unavailable so they know.
3. **Quote first, always.** Call `getSwapQuote` with the resolved
   from/to/amount/chain. Surface `estimatedOutput`, `priceImpact`,
   `liquiditySource` to the user. Quoting is free and read-only.
4. **Propose, don't execute.** Summarize the quote in one or two lines,
   then call `executeSwap`. The chat surface (Telegram or CLI) will
   pause for human approval before the tool's `execute` runs. Do not
   pretend the swap happened until the result lands.
5. **Read the policy result.** `executeSwap` returns either
   `{success, txHash, explorerUrl, ...}` or `{success: false, denied:
   true, deniedBy, reason, ...}`. If denied, surface the reason verbatim
   — do NOT retry by relaxing the size, slippage, or chain unless the
   user explicitly relaxes the constraint.
6. **Persist what was learned.** On success, call `rememberFact` if the
   trade revealed a durable preference ("user prefers Jupiter route",
   "default size for SOL buys is 0.5"). Skip if it was a one-off.

### 2. DCA plan — `createDCAPlan`

DCA is a multi-tick commitment, so the orchestration is:

0. **Fetch holdings first.** For prompts like "set up DCA for tokens I
   hold", "DCA my current tokens", "use my wallet", or "what should I DCA
   into", call `getPositions({ chain, limit: 25 })` before asking for
   token or chain information. If the user asks for totals too, call
   `getPortfolio` as well. Use the returned `symbol`, `quantity`, `value`,
   and `chain` fields in your reply.
1. **Only ask for inputs tools cannot infer.** After `getPositions`, the
   user should only need to provide missing intent: source token, per-tick
   amount, target token(s), schedule, or whether they want private
   execution. Never ask them to type the tokens they already hold.
2. **Confirm the cron expression in plain English.** "every Tuesday at
   noon" → say "I'll run this at 12:00 every Tuesday" before calling
   the tool. Misparsed cron is the #1 source of regret.
3. Pull defaults from memory: if `searchFacts({query: "default DCA
   size"})` returns a hit, propose that size; otherwise ask.
4. Call `createDCAPlan`. Approval gate fires same as for a swap.
5. After success, call `rememberFact` with the plan id under a stable
   key so future "pause my DCA" / "show my DCAs" requests have context.

### 3. Shield deposits / withdrawals — `depositToShield` / `withdrawFromShield`

Privacy flow specifics:

1. **Confirm the wallet has balance.** A `getPositions` or `getPortfolio`
   call is cheap insurance against an obvious failure.
2. **Match privacy intent to thresholds.** If the user said "private",
   the policy engine will auto-route through MagicBlock; you don't have
   to set `forcePrivate` unless they explicitly want to override.
3. **Quote-equivalent for shield**: `getShieldBalance` before a
   withdraw, so you can confirm the user is about to move what they
   think they are.
4. Same approval + result-handling rules as a swap.

### 4. Fuzzy memory recall — `searchFacts` over `recallFacts`

If the user says "what was that thing about my stable?":

1. Try `searchFacts({query: "stable preferences"})` first.
2. If `ragAvailable: false`, fall through to `recallFacts({query:
   "stable"})` (substring path; works without QVAC).
3. If both empty, ask the user — don't fabricate a preference.

For **explicit-key lookups** ("recall my dca_size") prefer `recallFacts`
or `listFacts` directly. Semantic search is for paraphrases.

### 5. Fact persistence — `rememberFact`

Only persist things that will be useful next session:

- Preferences ("prefers USDC for stables")
- Recurring sizes ("default DCA size: 25 USDC")
- Watchlists ("watchlist_solana: SOL,JUP,JTO")
- Plan ids you'll need to address later

Don't persist:

- One-off facts ("today the price was 230")
- Anything the agent can re-derive cheaply (current portfolio totals)
- Anything the user told you to forget — call `forgetFact` instead

## Hard-rule recap (these never bend)

- A claim of success requires a real `txHash` in a tool result. No
  optimistic confirmations.
- A policy denial is the final answer for that proposal — surface the
  `reason` verbatim and stop.
- Approval pauses are real chat-surface pauses. The tool's `execute`
  doesn't run until the user taps approve. Don't narrate as if it did.
- Fuzzy quantities ("some", "a bit", "moon size") get one clarifying
  question before any quote.

## Quick decision table

| User says | First tool to call | Then |
|---|---|---|
| "swap 0.1 SOL to USDC" | `getSwapQuote` | summarize → `executeSwap` |
| "buy SOL like last Tuesday" | `searchTradeHistory` | mirror → `getSwapQuote` → `executeSwap` |
| "what tokens do I hold?" | `getPositions` | summarize symbol, quantity, value, chain |
| "set up a weekly DCA into SOL" | `getPositions` if wallet context matters; otherwise clarify size + cron | `createDCAPlan` → `rememberFact` |
| "set up DCA for tokens I currently hold" | `getPositions` | propose based on holdings; ask only missing size/schedule/source |
| "park 1 SOL in private" | `getShieldBalance` | `depositToShield` |
| "what's that thing about stables?" | `searchFacts` | fall back to `recallFacts` if RAG off |
| "remember I prefer Jupiter" | `rememberFact` | (auto-indexed for future search) |

## Bundled references

- `references/value-moving-flow.md` — deeper notes on the policy gate,
  approval, and post-execution reasoning.
- `references/error-recovery.md` — how to interpret typed errors
  (`budget_exhausted`, `qvac_unavailable`, policy denials) and what the
  user-facing reply should look like.
