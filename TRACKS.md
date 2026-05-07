# AEGIS — Track Submission Map

Frontier hackathon — *"Build an Autonomous Onchain Agent using Zerion CLI"* + companion MagicBlock private-execution work.

## Submission summary

AEGIS is an LLM-driven autonomous trading agent built on the forked Zerion CLI. The model (Claude or GPT, switchable at runtime) reasons over portfolio + market signals, calls Zerion CLI verbs through a Vercel AI SDK 6 tool registry, and executes real onchain swaps via Zerion's swap router. Every value-moving call passes through a fail-closed policy engine (spend-limit, cooldown, slippage, time-window, consensus, privacy) before signing — and through a human-in-the-loop approval at the chat surface. MagicBlock provides the private-execution path for shielded balance management.

- **Headline:** an LLM agent that uses the Zerion CLI as its tool surface, talks in natural language, and cannot bypass the policy gate.
- **Real onchain proof:** Solana mainnet tx hashes captured during the demo run (links below, populated post-capture).
- **MagicBlock proof:** shield deposit + private transfer tx hashes.

## Tracks claimed

- **Zerion** — Build an Autonomous Onchain Agent using Zerion CLI. Evidence: `engine/agent/`, `engine/agent/tools/`, `engine/execution/executor.mjs`, README "Track requirements" table.
- **MagicBlock** — Privacy-first execution. Evidence: `engine/lib/magicblock/client.mjs`, `engine/execution/private-executor.mjs`, agent tools `depositToShield` / `withdrawFromShield` / `getShieldBalance`.
- **Tether QVAC ($10k USDt side prize)** — Local-first AI woven into core flows, not a wrapper.
  Four meaningful integrations:
  1. **Local-first RAG memory** — `@qvac/embed-llamacpp` embeds `AgentFact` and historical `AgentToolCall` rows; new tools `searchFacts` / `searchTradeHistory` / `summarizeSimilarTrades` give the agent semantic recall without sending memory to a cloud provider. (`engine/qvac/embeddings.mjs`, `engine/qvac/indexer.mjs`, `engine/agent/tools/memory-search.mjs`.)
  2. **Voice-controlled trading** — Telegram voice notes are transcribed locally with `@qvac/transcription-whispercpp`, routed through the same pipeline as text trades. `@qvac/tts-onnx` read-back is shipped (real `synthesize()` + PCM→OGG/Opus encoder in `engine/qvac/tts.mjs`); because the Supertonic model bundle has no public mirror the user drops the ONNX files into `QVAC_TTS_MODEL_DIR` manually — no mock fallback. (`engine/qvac/transcription.mjs`, `engine/qvac/tts.mjs`, `engine/bot/handlers/voice.mjs`.)
  3. **First-class local LLM provider** — `qvac/local` is a real `@ai-sdk/provider` v2 implementation (`engine/qvac/ai-sdk-provider/`) packaged so it can be extracted as the OSS `ai-sdk-qvac` community provider. `ToolLoopAgent` slots it in alongside `openai/*` and `anthropic/*` with full tool-calling.
  4. **Privacy posture** — every QVAC capability fails closed (typed `QvacUnavailableError`) and degrades to existing non-semantic paths; nothing silently falls back to a cloud API.

## Demo run — tx hashes

Captured 2026-05-03 against Solana devnet. Five real signatures, all verified `finalized`.

**Demo wallet 1** (`keys/demo.json`, pubkey `246cpiBMqxc8eLo1HZwtKJRribQNopPXsGr8yz8BXf7b`)

- **Seed transfer (main → demo, 0.1 SOL)**
  `DfyXHa1qbhAwB9onQwFeusNV2Z5UUAUUWeXDaryxzm6MePod4Nep23MDBwCyezJ3NKj9H6rhcLrzbpb18wfq7u2`
  <https://solscan.io/tx/DfyXHa1qbhAwB9onQwFeusNV2Z5UUAUUWeXDaryxzm6MePod4Nep23MDBwCyezJ3NKj9H6rhcLrzbpb18wfq7u2?cluster=devnet>
- **WSOL wrap (0.02 SOL → WSOL ATA)**
  `48o1UNFfC8wAng9yStTmHraEcKxhkD6vtvM2XkFYVtqsjqrzqEef8HgfUCHPMyd46x4SnZjo1kN2RYZyN2u5QnaU`
  <https://solscan.io/tx/48o1UNFfC8wAng9yStTmHraEcKxhkD6vtvM2XkFYVtqsjqrzqEef8HgfUCHPMyd46x4SnZjo1kN2RYZyN2u5QnaU?cluster=devnet>
- **MagicBlock shield deposit #1 (`delegateSpl` w/ `private: true`)**
  `5kdQ6DC93RJ12v4ns4uHvQajXmRVhuEDqzuW9Eus3E3fMb2G2mt9GmawriUhubD6mf7GpVDnvv7yBqaUjsNtASFR`
  <https://solscan.io/tx/5kdQ6DC93RJ12v4ns4uHvQajXmRVhuEDqzuW9Eus3E3fMb2G2mt9GmawriUhubD6mf7GpVDnvv7yBqaUjsNtASFR?cluster=devnet>

**Demo wallet 2** (`keys/demo2.json`, pubkey `D8fMQDTUAccCYt2hpaVw82cv82oQW6wDPfYvY46qvcAh`) — clean run with the corrected validator constant

- **Seed transfer (0.05 SOL)** — `3AtUn5wb8QTK7vkhfjQGRECefyZSo9Kc4nKCxQCJriWgypaBACViZjCNdrPpXPX6ZVbKLoCfXRFteguM13H3Fci1`
- **WSOL wrap (0.005 SOL)** — `3Dicpd1jKmJZwmjF3DXsomXen9s75z8LvirJLHSCdKf7GE9H5fpFvT6dHUa4V4qHFM5kHgzwdyqrxTNFxkobqp8s`
- **MagicBlock shield deposit #2 (correct validator `MAS1Dt9…`)** — `3JkQrWxZYhceMJEPLfv7JHyRFJ9KYUB3yewA7BUjSJhvHTAYuJMTSf3g5bdCn3VKHeqJo5SXXDH5KqAdewdswAD3`

Reproduce:
```
# fund a fresh demo keypair and wrap WSOL
node --env-file=.env scripts/seed-demo-wallet.mjs --amount=0.1
SOLANA_PRIVATE_KEY=$(cat keys/demo.json) node scripts/wrap-sol.mjs --amount=0.02

# then run the full pipeline (Phase 1–6) with --execute
SOLANA_PRIVATE_KEY=$(cat keys/demo.json) DATA_DIR=$(pwd)/.data \
  MAGICBLOCK_RPC_URL=https://api.devnet.solana.com \
  node --env-file=.env scripts/demo.mjs --execute --amount=0.001
```

### Bug found and fixed during the run — wrong validator constant

The original `engine/lib/magicblock/client.mjs` had `DEFAULT_PRIVATE_VALIDATOR = FnE6V…BGi` hardcoded from an older example. The live `https://devnet.magicblock.app` ER reports its identity as `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57` via `getIdentity`. Deposits with a stale validator pubkey land on-chain (delegation tx confirms) but never get picked up by the real ER, leaving the WSOL stranded in the vault. The constant is now pulled from the live endpoint and the second deposit (signature #5 above) lands correctly.

### Open issue — `withdrawSpl` returns `DelegationRecordInvalidAccountOwner`

After a successful private deposit, the SDK's idempotent `withdrawSpl` path (default) tries to re-emit `delegateEphemeralAtaIx` on the ER as the first step. The on-chain delegation program rejects with:

```
Program log: Invalid owner for account. Label: delegation record
Program log: fast_process_instruction: DelegationRecordInvalidAccountOwner
Program DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh failed: custom program error: 0x1b
```

The SDK assumes a non-delegated starting state for the withdraw, but the deposit's `delegateSpl({ private: true })` leaves the EATA delegated. The legacy single-ix path (`idempotent: false`) fails on base with `Invalid account owner` (the ATA is owned by the delegation program, not the user) and on the ER with `invalid program argument`. Need confirmation from MagicBlock support on the canonical "withdraw after `private: true` deposit" sequence.

This blocks only the withdraw + private intra-rollup transfer signatures; the deposit half of the cycle is verified end-to-end across two independent runs.

## Hard constraints — checklist

- [x] Built on the forked Zerion CLI (this repo).
- [x] Real onchain transactions (Zerion swap router; verified by tx hash).
- [x] Swap path goes through Zerion's routing (see `utils/trading/swap.js:executeSwap`).
- [x] MagicBlock integration is user-facing — `depositToShield` / `withdrawFromShield` are first-class agent tools, not bolted on.
- [x] Policy engine is fail-closed: empty config → `MissingPolicyConfigError`; executor refuses proposals without an approved `policyResult`. Verified by `tests/unit/policies/no-bypass.test.mjs` and `tests/unit/agent/no-bypass.test.mjs`.

## Reference

- Project root: this directory (``).
- Canonical track sources: `resources/track_description_1.md`, `resources/track_description_2.md` (read-only reference).
- Demo video: *(link inserted after capture)*.
