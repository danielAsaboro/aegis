# Value-Moving Flow — Deep Notes

## What "value-moving" means in AEGIS

Tools that move user funds or commit a wallet to future spend:

- `executeSwap` (immediate trade)
- `createDCAPlan` (recurring trades)
- `depositToShield` / `withdrawFromShield` (privacy moves)

Read-only tools (`getPortfolio`, `getTokenPrice`, `getSwapQuote`,
`searchFacts`, `searchTradeHistory`) are *not* value-moving. They never
need approval, never run policies, and the model is free to call them
proactively.

## The policy gate is authoritative

`executeSwap.execute` always runs `runPolicies(proposal, getDefaultPolicies('manual'))`
**before** any signing. The chat-surface approval is a second gate, but the
policy engine is the one that can never be bypassed:

- An empty/missing policy config raises `MissingPolicyConfigError`.
- The executor refuses to sign without an `approved` policyResult.
- This is verified by `tests/unit/policies/no-bypass.test.mjs`.

When the model sees `{success: false, denied: true, deniedBy, reason}`,
those fields come from the policy engine. Trust them.

## What approval pauses look like to the agent

When `needsApproval: true` is set on a tool (executeSwap, createDCAPlan,
depositToShield, withdrawFromShield), the AI SDK pauses the tool loop.
The agent's response in that turn includes a `tool-approval-request`
content part instead of the tool result. The chat surface (Telegram
keyboard or CLI prompt) collects approve/deny, then resumes the loop.

From the agent's perspective:

- **Don't summarize as if the action happened.** The next turn's tool
  result will tell you whether it ran or not.
- **Don't loop trying again** if the user denies — stop, ask why, or
  propose an alternative.
- **The same approval flow applies to voice trades** — voice is just a
  different input modality.

## Post-execution reasoning

After a successful tool call:

1. The result includes `txHash` and `explorerUrl` (for swaps) or a
   `signature` (for shield ops). Render those as-is.
2. Policy result fields (`policyResult.usePrivate`, route summary) tell
   you whether the trade went through MagicBlock private execution.
   Mention privacy when it materially differs from what the user asked
   for.
3. Consider `rememberFact` for durable insights but not for trade
   transcripts — `getHistory` already preserves those.

After a failure:

- `success: false, error: "..."` from the executor → infrastructure or
  routing problem. Surface the message, suggest a smaller size or a
  different chain only if the user opens that door.
- `success: false, denied: true, ...` → policy refusal. Don't retry.

## Why "quote, then propose, then execute"

It's not just for safety — it's how the user's mental model maps to the
agent's actions. They expect to see numbers, then approve, then see the
hash. Skipping the quote step means they're approving blind. Even if
policies would catch the bad trade, you've still wasted their time and
trust.
