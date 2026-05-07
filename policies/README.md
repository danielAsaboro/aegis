# AEGIS Policy Surface

Every value-moving instruction in AEGIS — `executeSwap`, `createDCAPlan`,
`depositToShield`, `withdrawFromShield` — runs `runPolicies(proposal,
policyConfig)` *inside* its `execute()` body before signing. The engine
is fail-closed: an empty config raises `MissingPolicyConfigError` and
the executor refuses any proposal that does not carry an approved
`policyResult`. There is no back door. Verified by
`tests/unit/policies/no-bypass.test.mjs` and
`tests/unit/agent/no-bypass.test.mjs`.

The single entry point is `engine/policies/engine.mjs:runPolicies`.
Semantics: AND. Every active policy must pass; the first denial
short-circuits and is returned with the policy name and reason. The
contract every policy implements:

```js
check(ctx) → { allow: boolean, reason?: string, usePrivate?: boolean }
```

`ctx` carries `{ transaction, policy_config, proposal }`. `usePrivate`
is the privacy policy's routing decision — see below.

## The eight policies

| Policy | File | Purpose | Fail mode | Config example |
|---|---|---|---|---|
| `spend-limit` | `policies/spend-limit.mjs` | Per-tick, rolling 24h, lifetime USD caps per strategy | Deny if any cap would be exceeded | `{ perTick: 25, daily: 100, total: 1000 }` |
| `time-window` | `policies/time-window.mjs` | Restrict trades to UTC hour range; optional days-of-week mask. Wraps midnight when `startHour > endHour` | Deny outside window | `{ startHour: 13, endHour: 21, days: [1,2,3,4,5] }` |
| `price-guard` | `policies/price-guard.mjs` | Bound max slippage and optional absolute price floor/ceiling against the live quote in `ctx.proposal.quote` | Deny if slippage exceeds bound, or quoted price outside bounds | `{ maxSlippage: 3, minPrice: 140, maxPrice: 200 }` |
| `cooldown` | `policies/cooldown.mjs` | Minimum interval between trades per strategy | Deny if last trade newer than `intervalMs` | `{ intervalMs: 60_000 }` |
| `allowlist` | `policies/allowlist.mjs` | EVM-only — restrict `tx.to` to a whitelist of contract addresses | Deny if destination not in `allowed_addresses` | `{ allowed_addresses: ['0x...'] }` |
| `deny-approvals` | `policies/deny-approvals.mjs` | Block ERC-20 `approve()` and `increaseAllowance()` (selectors `0x095ea7b3`, `0x39509351`) so an attacker cannot pre-authorize a future drain | Deny on matching selector | (no config) |
| `deny-transfers` | `policies/deny-transfers.mjs` | Block raw native transfers (value > 0, empty calldata) — never needed for DEX swaps | Deny on raw transfer | (no config) |
| `consensus` | `engine/policies/consensus.mjs` | N/M Telegram-vote gate for `group` strategies | Deny until quorum | `{ requiredVotes: 3, expiresInMinutes: 15 }` |

A ninth, structurally distinct policy:

| Policy | File | Purpose |
|---|---|---|
| `privacy` | `engine/policies/privacy.mjs` | Routing, not gating. Always returns `allow: true`; sets `usePrivate: true` when amount > `thresholdUsd`, the from/to token is in `PRIVACY_TOKENS`, the strategy carries `forcePrivate`, or `PRIVACY_MODE=on`. The executor reads `policyResult.usePrivate` to decide between Zerion's public router and `engine/execution/private-executor.mjs` (MagicBlock Ephemeral Rollup). |

## Fail-closed proof

```js
// engine/policies/engine.mjs
if (activePolicies.length === 0) {
  policyLog.error({ proposalId: proposal.id }, 'Refused: no policies configured');
  throw new MissingPolicyConfigError(proposal.id);
}
```

```js
// engine/execution/executor.mjs
if (!proposal.policyResult || proposal.policyResult.approved !== true) {
  throw new Error('executeTrade refused: proposal carries no approved policyResult');
}
```

There is no way to reach the swap router or the MagicBlock client
without a `policyResult.approved === true` carrying the named results
from every active policy.

## Defaults per strategy

`engine/policies/engine.mjs:getDefaultPolicies(strategyType)`:

| Strategy | Defaults |
|---|---|
| `manual` | `{ spend-limit: {perTick:25,daily:100,total:1000}, cooldown: {intervalMs:60_000} }` |
| `dca` | manual + `time-window: {startHour:0,endHour:24}` |
| `dip-buyer`, `take-profit` | manual + `price-guard: {maxSlippage:3}` |
| `rebalancer` | manual + `price-guard: {maxSlippage:3}` + larger spend caps |
| `group` | manual + `consensus: {requiredVotes:3,expiresInMinutes:15}` |

Override at strategy creation, per-user via `/policy`, or per-call by
passing an explicit `policyConfig` to the value-moving tool.

## Adding a new policy

1. Create `policies/<name>.mjs` exporting `async function check(ctx)`.
2. Register it in `engine/policies/engine.mjs` `POLICIES`.
3. Add a row to `listAvailablePolicies()`.
4. Write `tests/unit/policies/<name>.test.mjs` exercising at minimum:
   one allow, one deny with reason, one no-config-falls-back-safe.
5. Update this README.

The Zerion CLI keeps the executable shim shape (`if (process.argv[1]
=== fileURLToPath(import.meta.url)) ...`) so the policy can be invoked
standalone from the CLI policy chain — the same `check(ctx)` runs in
both the agent path and the legacy CLI path.

## Tests

```bash
pnpm test:unit  # all policy tests + no-bypass guarantees
```

Single files:

```bash
node --test tests/unit/policies/no-bypass.test.mjs
node --test tests/unit/agent/no-bypass.test.mjs
```
