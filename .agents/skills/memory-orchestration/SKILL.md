---
name: memory-orchestration
description: AEGIS memory playbook for remembering, recalling, summarizing, and pruning user/project knowledge. Load whenever the user says remember, recall, forget, what did we learn, use our notes/plans/issues, search memory, summarize prior work, apply a preference from earlier, or references past trades/plans vaguely such as "the usual", "last time", "that issue", "our plan", or "the one that failed".
---

# Memory Orchestration

## Memory surfaces

AEGIS has three memory surfaces:

- Recent conversation history: loaded automatically for the current user.
- Durable facts: `rememberFact`, `recallFacts`, `listFacts`, `forgetFact`.
- Semantic memory: `searchFacts`, `searchTradeHistory`,
  `summarizeSimilarTrades` when QVAC RAG is available.

Use tools before asking the user to repeat prior context.

## What to remember

Persist facts that will matter in a future session:

- User preferences: stablecoin choice, risk posture, privacy preference,
  default chain, default source token, notification style.
- Recurring sizes and schedules: default DCA size, preferred rebalance
  cadence, alert thresholds, spend comfort limits.
- Watchlists and strategy intent: tokens to monitor, strategy names,
  target allocations, paused/active plan ids.
- Project lessons: fixed bugs, open issues, demo/proof constraints,
  commands that worked, commands that failed and why.
- Durable constraints: "use the active wallet first", "never ask me for
  tokens before checking positions", "prefer codex/default for testing".

Do not remember:

- Private keys, seed phrases, API keys, session tokens, OTPs, passphrases.
- One-off prices, temporary balances, transient errors, or market values
  that can be fetched again.
- Raw tool payloads when a short summary is enough.
- Sensitive personal data unless the user explicitly asks and it is needed
  for the product.

## Stable keys

Use short, updateable keys so later facts replace old ones:

| Fact type | Key pattern | Category |
|---|---|---|
| Stablecoin preference | `stable_preference` | `preference` |
| DCA default size | `default_dca_size` | `size` |
| Strategy watchlist | `watchlist_solana` | `watchlist` |
| Privacy preference | `privacy_preference` | `preference` |
| Default model for testing | `agent_model_preference` | `runtime` |
| Open product issue | `issue_<short_slug>` | `issue` |
| Fixed product issue | `fixed_<short_slug>` | `lesson` |
| Demo proof constraint | `proof_<short_slug>` | `proof` |
| Current plan | `plan_<short_slug>` | `plan` |

Prefer updating the existing key over creating duplicates.

## Recall flow

1. If the user names an exact key or category, call `recallFacts` or
   `listFacts` first.
2. If the user uses fuzzy language, call `searchFacts`.
3. If `searchFacts` returns `ragAvailable: false`, fall back to
   `recallFacts` with the strongest substring from the user request.
4. If the user references past trades or value-moving actions, call
   `searchTradeHistory` or `summarizeSimilarTrades`.
5. If no memory result answers the request, say that memory did not have
   it and ask one concrete follow-up.

Never invent a remembered fact.

## Notes, plans, and issues

When the user asks to use notes/plans/issues:

- Recall categories in this order: `issue`, `plan`, `lesson`, `proof`,
  `runtime`, `preference`.
- Summarize into actionable bullets: what happened, current state, next
  step, and risk.
- Persist new durable conclusions with `rememberFact` after acting on them.
- If a note points to a code/runtime problem, verify against the current
  repo before presenting it as still true.

Build-session lessons to preserve when relevant:

- Hidden state caused most proof failures: wrong active wallet, expired
  token/policy, stale simulator flags, or environment-specific broadcast
  assumptions. Make state explicit before proof runs.
- Current wallet state must come from tools. If a positions/portfolio tool
  fails, report the failure; do not ask the user to type the token list or
  infer an empty wallet from a failed read.
- Local QVAC CPU turns can be slow. A timeout or "already running" error is
  a runtime contention signal, not proof the user request is impossible.
- For Telegram, natural-language replies should be Telegram-native text:
  no raw markdown, decorative backticks, fenced pseudo-JSON, or leaked model
  scratch structure.
- For demos/proofs, prefer disposable, explicit, isolated setup: resolved
  wallet address, fresh scoped policy/token, known model, known RPC, and
  captured tx/proof output.

## Trade-memory flow

For prompts like "do the usual", "like last Tuesday", "repeat the one
that worked", or "avoid the one that failed":

1. Call `summarizeSimilarTrades` with the user's intent.
2. If unavailable, call `searchTradeHistory`.
3. If still unavailable, use `getHistory` for chronological wallet
   history and explain that semantic trade memory is unavailable.
4. Quote before execution and keep all policy/approval gates intact.

## Privacy and safety

- Memory tools are per-user scoped. Do not reveal another user's facts.
- Redact secrets if the user accidentally provides them; remember only a
  safe statement such as "user rotated the leaked key".
- `forgetFact` only by explicit user request or when replacing a stale
  fact with a safer canonical key.
- Facts are not proof of current onchain state. Use wallet and market tools
  for current balances, prices, policies, and transactions.
