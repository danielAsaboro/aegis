# Error Recovery

How to interpret AEGIS's typed error codes and what the user-facing
reply should look like.

## `budget_exhausted`

Hourly per-user agent budget hit (default 20 turns/hr).

**Don't retry the same call.** Tell the user when the budget resets and
suggest a non-agent path if available (e.g. `/trade` slash command for
a manual swap).

```
Hourly agent budget reached — try again at 14:30. For an immediate
manual trade, use `/trade swap <amount> <from> <to>`.
```

## Policy denials

Tool returns `{success: false, denied: true, deniedBy, reason, proposalId}`.
`deniedBy` names the policy that refused (e.g. `spendLimit`, `cooldown`,
`slippage`, `timeWindow`, `consensus`).

**Don't retry by relaxing the constraint silently.** The denial is the
final answer for this proposal. Surface `reason` verbatim and stop. If
the user wants to relax the policy, they have to do it explicitly through
`/policy` or by acknowledging the constraint:

```
Trade refused (cooldown): last manual swap was 12 minutes ago; policy
requires 15 minutes between manual trades. I can wait 3 minutes and
retry, or you can adjust the cooldown via `/policy`.
```

## `qvac_unavailable`

A QVAC capability (embeddings, transcription, TTS, LLM) couldn't load
because the model file is missing or the sidecar failed to start.

Specific tools degrade differently:

- `searchFacts` / `searchTradeHistory` → fall back to `recallFacts` /
  `getHistory`. Tell the user RAG is off.
- Voice handler → reply "voice support unavailable" with the reason.
- `qvac/local` LLM provider → throws on `resolveModel`; user must switch
  with `/agent model openai/gpt-5` or run `pnpm qvac:download`.

Never silently substitute a cloud API for a missing local one — it
defeats the privacy posture.

## `no_policy_result` / `missing_policy_config`

These are wiring bugs: a value-moving tool ran without a policy result
attached, or a policy config is empty. Surface them to the user as a
trust failure, not a transient error:

```
Trade refused: a policy gate didn't run (no_policy_result). This is a
wiring bug; do not retry. Please report this with the proposalId.
```

## `AbortError`

User pressed Ctrl+C in CLI or hit a cancel button. Silent — no
user-facing message needed. The chat surface already showed the
abort indicator.

## Recovery strategy summary

| Error code | Retry? | User reply |
|---|---|---|
| `budget_exhausted` | No, until reset | "try again at HH:MM" |
| Policy denial (any) | No, until user relaxes | reason verbatim |
| `qvac_unavailable` (RAG) | Use fallback tool | "RAG unavailable, used substring search" |
| `qvac_unavailable` (voice) | No | "voice unavailable: reason" |
| `qvac_unavailable` (LLM) | No | suggest model switch |
| `no_policy_result` | No | report wiring bug |
| `missing_policy_config` | No | "missing config: reason" |
| `AbortError` | No | (silent) |
| swap-route failure | Maybe | ask user before retrying with different chain/route |
