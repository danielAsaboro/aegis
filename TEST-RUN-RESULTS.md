# Test Run Results

Date: 2026-05-01

Environment notes:
- `bare-runtime` resolves locally.
- `pnpm test:all` now loads `.env` via `node --env-file=.env`, matching the rest of the repo's E2E scripts.
- The current environment exposes real-looking `ZERION_API_KEY`, `SOLANA_PRIVATE_KEY`, `MAGICBLOCK_RPC_URL`, `MAGICBLOCK_EPHEMERAL_URL`, and `TELEGRAM_BOT_TOKEN`, but outbound network access is unavailable here, so live Zerion/Solana/Telegram checks skip on `fetch failed`.
- `pnpm db:push` only succeeded after overriding `DATA_DIR` to a repo-local writable path (`.data`); the default `~/.zerion/aegis.db` location was read-only in this environment.
- Fresh temp SQLite files used by E2E/unit Prisma tests now push the schema before opening, so `init*Store(testDir)` no longer explodes on missing tables.

## Results

| Suite | Command | Tests | Passed | Failed | Skipped | Notes |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| DB bootstrap | `DATA_DIR=$PWD/.data pnpm db:push` | n/a | 1 | 0 | 0 | Succeeds with repo-local SQLite path. Default path failed with `attempt to write a readonly database`. |
| Unit | `DATA_DIR=$PWD/.data pnpm test:unit` | 151 | 151 | 0 | 0 | Green after isolating keystore tests under a temp `HOME` instead of `/Users/cartel/.ows`. |
| Policy gate | `node --test tests/unit/policies/no-bypass.test.mjs` | 5 | 5 | 0 | 0 | Green. |
| Agent no-bypass | `node --test tests/unit/agent/no-bypass.test.mjs` | 2 | 2 | 0 | 0 | Green after private executor was changed to fail honestly on unsupported `USDC -> SOL` private swaps. |
| Integration | `DATA_DIR=$PWD/.data pnpm test:integration` | 21 | 2 | 0 | 19 | Green. Most tests are credential-gated skips; the invalid-key live check now skips explicitly when the environment cannot reach Zerion and returns `fetch failed`. |
| Integration API (env-loaded) | `DATA_DIR=$PWD/.data node --env-file=.env --test tests/integration/api.test.mjs` | 15 | 3 | 0 | 12 | Green. Live Zerion portfolio/positions/history/pnl/ENS checks now skip on network-class CLI failures instead of hard-failing the suite. |
| QVAC unit | `pnpm test:qvac` | 24 | 24 | 0 | 0 | Green. |
| QVAC integration | `DATA_DIR=$PWD/.data pnpm test:qvac:integration` | 2 | 2 | 0 | 0 | Green. Live-model branch remains effectively unavailable without model artifacts. |
| AEGIS E2E | `DATA_DIR=$PWD/.data node --env-file=.env --test tests/e2e/aegis.e2e.test.mjs` | 7 | 1 | 0 | 6 | Green. The suite now boots the current Prisma-backed stores correctly and skips only on real Solana preflight network failure. |
| Privacy E2E | `DATA_DIR=$PWD/.data pnpm test:e2e:privacy` | 8 | 0 | 0 | 8 | The suite now loads and skips cleanly when real Solana/MagicBlock preflight fails with `Connection.getBalance(...): TypeError: fetch failed`. |
| DCA E2E | `DATA_DIR=$PWD/.data node --env-file=.env --test tests/e2e/dca-strategy.test.mjs` | 5 | 0 | 0 | 5 | Green. No stale Prisma API usage remains; the suite skips only on live preflight fetch failures. |
| Working Wallet E2E | `DATA_DIR=$PWD/.data node --env-file=.env --test tests/e2e/working-wallet.test.mjs` | 7 | 5 | 0 | 2 | Green. The environment coverage check now reports state honestly instead of failing when no variables are present. |
| Aggregate | `DATA_DIR=$PWD/.data pnpm test:all` | 223 | 164 | 0 | 59 | Green. This is the current repo-wide ground truth after loading `.env` and normalizing live-network skips. |

## Additional Ground-Truth Findings

- The stale Prisma-era E2E failures are gone. `aegis.e2e`, `dca-strategy`, `group-consensus`, `signal-automation`, `wallet-operations`, and `privacy-trading` all boot against the current async Prisma-backed stores.
- `test:all` now reflects the same environment-loading behavior as the dedicated E2E scripts. Before this fix, it silently ignored `.env` and produced misleading "missing env var" skips.
- Live integration and E2E suites now distinguish product failures from environment failures. When Zerion/Solana/Telegram are unreachable from this machine, they skip with explicit network reasons instead of fake-passing or failing on stale assumptions.
- No real onchain proof hashes were captured in this pass. The code and tests are in a consistent state, but outbound network access is unavailable here, so mainnet/devnet proof capture is still pending a live run in a network-enabled environment.
