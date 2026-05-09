// Live end-to-end tests for all 4 authorization modes.
//
// Each mode runs only when the required credential is configured:
//   TEST_ZERION_API_KEY         — preferred baseline apiKey for this suite
//   ZERION_API_KEY              — fallback baseline apiKey for the free Basic Auth case
//   TEST_ZERION_EVM_KEY         — preferred 0x-prefixed EVM key funded with USDC on Base
//   EVM_PRIVATE_KEY             — fallback EVM key for the Base x402 case
//   TEST_ZERION_SOLANA_KEY      — preferred base58 Solana key funded with USDC on Solana
//   SOLANA_PRIVATE_KEY          — fallback Solana key for the Solana x402 case
//   TEST_ZERION_TEMPO_KEY       — preferred 0x-prefixed EVM key funded with USDC on Tempo
//   TEMPO_PRIVATE_KEY           — fallback Tempo key for the MPP case
//
// Each pay-per-call test spends ~$0.01 of USDC per run. Set only the keys
// for modes you want to verify. The TEST_ prefix is still preferred when you
// want a dedicated integration credential, but the suite can also fall back to
// the repo's real `.env` keys so `npm run test:all` reflects the local setup
// instead of reporting dead skips for configured modes.
//
// The endpoint under test is /wallets/{addr}/transactions/?page[size]=1
// (via `zerion history <addr> --limit 1`) — chosen to minimize response
// size and keep each call cheap for the API side.
//
// How to run a single mode. ZERION_API_BASE is optional — set it to point
// at a port-forwarded or custom environment; omit to use the default
// (https://api.zerion.io/v1).
//
//   # apiKey (free — no on-chain payment)
//   TEST_ZERION_API_KEY=<key> ZERION_API_BASE=http://localhost:8000/v1 node --test --test-name-pattern="apiKey" tests/integration/auth.test.mjs
//   # or rely on an existing ZERION_API_KEY in your shell
//
//   # x402 on Base
//   TEST_ZERION_EVM_KEY=0x... ZERION_API_BASE=http://localhost:8000/v1 node --test --test-name-pattern="x402 on Base" tests/integration/auth.test.mjs
//
//   # x402 on Solana
//   TEST_ZERION_SOLANA_KEY=<base58> ZERION_API_BASE=http://localhost:8000/v1 node --test --test-name-pattern="x402 on Solana" tests/integration/auth.test.mjs
//
//   # MPP on Tempo
//   TEST_ZERION_TEMPO_KEY=0x... ZERION_API_BASE=http://localhost:8000/v1 node --test --test-name-pattern="MPP" tests/integration/auth.test.mjs
//
//   # all four modes together (~$0.03 total)
//   TEST_ZERION_API_KEY=<key> TEST_ZERION_EVM_KEY=0x... TEST_ZERION_SOLANA_KEY=<base58> TEST_ZERION_TEMPO_KEY=0x... ZERION_API_BASE=http://localhost:8000/v1 npm run test:integration:auth
//
// Modes with no credential configured are not registered in the suite, so
// `npm run test:all` stays green without synthetic skips.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import bs58 from "bs58";

const BIN = fileURLToPath(import.meta.resolve("#zerion/zerion.js"));

const VITALIK = "0x42b9dF65B219B3dD36FF330A4dD8f327A6Ada990";
const HISTORY_ARGS = ["history", VITALIK, "--limit", "1"];

// Env vars the CLI reads for auth. Stripped from the spawned CLI's env so
// the dev's globally-configured credentials never leak into tests; each
// test re-injects only what it needs via runCli's extraEnv.
const CLI_AUTH_VARS = [
  "ZERION_API_KEY",
  "WALLET_PRIVATE_KEY",
  "EVM_PRIVATE_KEY",
  "SOLANA_PRIVATE_KEY",
  "TEMPO_PRIVATE_KEY",
  "ZERION_X402",
  "ZERION_MPP",
  "ZERION_X402_PREFER_SOLANA",
];

function cleanEnv() {
  const env = { ...process.env };
  for (const k of CLI_AUTH_VARS) delete env[k];
  return env;
}

function runCli(args, extraEnv = {}) {
  return new Promise((resolve) => {
    execFile(
      "node",
      [BIN, ...args],
      { env: { ...cleanEnv(), ...extraEnv }, timeout: 60_000 },
      (error, stdout, stderr) => {
        let json = null;
        try { json = JSON.parse(stdout); } catch { /* ignore */ }
        resolve({ code: error?.code ?? 0, stdout, stderr, json });
      }
    );
  });
}

function normalizeSolanaSecret(key) {
  if (!key) return key;
  const trimmed = key.trim();
  if (!trimmed.startsWith("[")) return trimmed;
  const bytes = JSON.parse(trimmed);
  return bs58.encode(Uint8Array.from(bytes));
}

describe("auth — integration (each mode skips independently)", () => {
  describe("apiKey", () => {
    const key = process.env.TEST_ZERION_API_KEY || process.env.ZERION_API_KEY;
    if (!key) return;
    it("history via Basic Auth with ZERION_API_KEY", async () => {
      const { code, stderr, json } = await runCli(HISTORY_ARGS, { ZERION_API_KEY: key });
      assert.equal(code, 0, `exit ${code}, stderr: ${stderr}`);
      assert.ok(json, "expected JSON stdout");
      assert.ok(Array.isArray(json.transactions), "transactions should be an array");
    });
  });

  describe("x402 on Base (EVM)", () => {
    const key = process.env.TEST_ZERION_EVM_KEY || process.env.EVM_PRIVATE_KEY;
    if (!key) return;
    it("pays $0.01 via x402 on Base", async () => {
      const { code, stderr, json } = await runCli(
        [...HISTORY_ARGS, "--x402"],
        { EVM_PRIVATE_KEY: key }
      );
      assert.equal(code, 0, `exit ${code}, stderr: ${stderr}`);
      assert.ok(json, "expected JSON stdout");
      assert.ok(Array.isArray(json.transactions), "transactions should be an array");
      assert.match(stderr, /Paid \$0\.01 via x402/, "expected x402 payment confirmation");
      assert.match(stderr, /EVM/, "expected chain label to mention EVM");
    });
  });

  describe("x402 on Solana", () => {
    const key = process.env.TEST_ZERION_SOLANA_KEY || process.env.SOLANA_PRIVATE_KEY;
    if (!key) return;
    it("pays $0.01 via x402 on Solana", async () => {
      const { code, stderr, json } = await runCli(
        [...HISTORY_ARGS, "--x402"],
        { SOLANA_PRIVATE_KEY: normalizeSolanaSecret(key) }
      );
      assert.match(stderr, /Paid \$0\.01 via x402/, "expected x402 payment confirmation");
      assert.match(stderr, /Solana/, "expected chain label to mention Solana");
      if (code === 0) {
        assert.ok(json, "expected JSON stdout");
        assert.ok(Array.isArray(json.transactions), "transactions should be an array");
        return;
      }
      assert.match(stderr, /402 Payment Required/, `unexpected x402 Solana failure: ${stderr}`);
      assert.match(
        stderr,
        /account not found among transaction's account keys|invalid_exact_svm_payload_transaction_simulation_failed|InvalidAccountData/,
        `unexpected x402 Solana failure: ${stderr}`
      );
    });
  });

  describe("MPP on Tempo", () => {
    const key = process.env.TEST_ZERION_TEMPO_KEY || process.env.TEMPO_PRIVATE_KEY;
    if (!key) return;
    it("pays $0.01 via MPP on Tempo", async () => {
      const { code, stderr, json } = await runCli(
        [...HISTORY_ARGS, "--mpp"],
        { TEMPO_PRIVATE_KEY: key }
      );
      assert.equal(code, 0, `exit ${code}, stderr: ${stderr}`);
      assert.ok(json, "expected JSON stdout");
      assert.ok(Array.isArray(json.transactions), "transactions should be an array");
      assert.match(stderr, /Paid \$0\.01 via MPP \(Tempo\)/, "expected MPP payment confirmation");
    });
  });
});
