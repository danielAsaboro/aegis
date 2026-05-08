import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getApiKey } from "#zerion/utils/config.js";

const BIN = fileURLToPath(import.meta.resolve("#zerion/zerion.js"));

const API_KEY = getApiKey() || "";
const SKIP = !API_KEY;
const SKIP_MSG = "Skipping: no API key found (set ZERION_API_KEY or run `zerion config set apiKey <key>`)";

const VITALIK = "0x42b9dF65B219B3dD36FF330A4dD8f327A6Ada990";

function runOnce(args) {
  return new Promise((resolve) => {
    execFile(
      "node",
      [BIN, ...args],
      { env: { ...process.env }, timeout: 30000 },
      (error, stdout, stderr) => {
        resolve({
          code: error?.code ?? 0,
          stdout,
          stderr,
          json: (() => {
            try { return JSON.parse(stdout); } catch {}
            try { return JSON.parse(stderr); } catch {}
            return null;
          })(),
        });
      }
    );
  });
}

function isNetworkUnavailable(result) {
  const message = [
    result?.json?.error?.message,
    result?.stderr,
    result?.stdout,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    result?.code !== 0 &&
    /fetch failed|getaddrinfo|ENOTFOUND|ECONNREFUSED|ECONNRESET|network/i.test(message)
  );
}

function assertSuccessOrSkipNetwork(t, result) {
  if (isNetworkUnavailable(result)) {
    t.skip('network unavailable for live Zerion integration test');
    return false;
  }
  assert.equal(result.code, 0);
  assert.ok(result.json);
  return true;
}

// Live integration tests share the dev-key rate budget. Parallel `node --test`
// runs trip 429 in bursts, so retry rate-limited responses with backoff before
// failing the assertion.
async function run(args, { retries = 3 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await runOnce(args);
    const msg = result.json?.error?.message ?? "";
    const rateLimited = result.code !== 0 && /429|too many requests|rate limit/i.test(msg);
    if (!rateLimited || attempt === retries) return result;
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}

describe("integration tests (requires ZERION_API_KEY)", () => {
  before(() => {
    if (SKIP) console.log(`  ${SKIP_MSG}`);
  });

  describe("portfolio", () => {
    it("returns portfolio for valid address", { skip: SKIP ? SKIP_MSG : false }, async (t) => {
      const result = await run(["portfolio", VITALIK]);
      if (!assertSuccessOrSkipNetwork(t, result)) return;
      const { json } = result;
      assert.ok(json.wallet);
      assert.ok(json.portfolio);
      assert.ok(typeof json.portfolio.total === "number");
    });

    it("works with ENS name", { skip: SKIP ? SKIP_MSG : false }, async (t) => {
      const result = await run(["portfolio", "vitalik.eth"]);
      if (!assertSuccessOrSkipNetwork(t, result)) return;
      const { json } = result;
      assert.ok(json.wallet);
      assert.equal(json.wallet.name, "vitalik.eth");
    });
  });

  describe("positions", () => {
    it("returns positions array", { skip: SKIP ? SKIP_MSG : false }, async (t) => {
      const result = await run(["positions", VITALIK]);
      if (!assertSuccessOrSkipNetwork(t, result)) return;
      const { json } = result;
      assert.ok(Array.isArray(json.positions));
    });

    it("filters by chain", { skip: SKIP ? SKIP_MSG : false }, async (t) => {
      const result = await run(["positions", VITALIK, "--chain", "ethereum"]);
      if (!assertSuccessOrSkipNetwork(t, result)) return;
      const { json } = result;
      assert.ok(Array.isArray(json.positions));
    });

    it("filters by --positions simple", { skip: SKIP ? SKIP_MSG : false }, async (t) => {
      const result = await run(["positions", VITALIK, "--positions", "simple"]);
      if (!assertSuccessOrSkipNetwork(t, result)) return;
      const { json } = result;
      assert.ok(Array.isArray(json.positions));
    });

    it("filters by --positions defi", { skip: SKIP ? SKIP_MSG : false }, async (t) => {
      const result = await run(["positions", VITALIK, "--positions", "defi"]);
      if (!assertSuccessOrSkipNetwork(t, result)) return;
      const { json } = result;
      assert.ok(Array.isArray(json.positions));
    });
  });

  describe("transactions", () => {
    it("returns transactions data", { skip: SKIP ? SKIP_MSG : false }, async (t) => {
      const result = await run(["history", VITALIK]);
      if (!assertSuccessOrSkipNetwork(t, result)) return;
      const { json } = result;
      assert.ok(Array.isArray(json.transactions));
    });

    it("respects custom limit", { skip: SKIP ? SKIP_MSG : false }, async (t) => {
      const result = await run(["history", VITALIK, "--limit", "5"]);
      if (!assertSuccessOrSkipNetwork(t, result)) return;
      const { json } = result;
      assert.ok(json.transactions.length <= 5);
    });

    it("filters by chain", { skip: SKIP ? SKIP_MSG : false }, async (t) => {
      const result = await run(["history", VITALIK, "--chain", "ethereum"]);
      if (!assertSuccessOrSkipNetwork(t, result)) return;
    });
  });

  describe("pnl", () => {
    it("returns PnL data", { skip: SKIP ? SKIP_MSG : false }, async (t) => {
      const result = await run(["pnl", VITALIK]);
      if (!assertSuccessOrSkipNetwork(t, result)) return;
      const { json } = result;
      assert.ok(json.wallet);
      assert.ok(json.pnl);
    });
  });

  describe("chains", () => {
    it("returns chains array", { skip: SKIP ? SKIP_MSG : false }, async () => {
      const { code, json } = await run(["chains"]);
      assert.equal(code, 0);
      assert.ok(json);
      assert.ok(Array.isArray(json.chains));
      assert.ok(json.chains.length > 0);
    });
  });

  describe("analyze", () => {
    it("returns full analysis", { skip: SKIP ? SKIP_MSG : false }, async (t) => {
      const result = await run(["analyze", VITALIK]);
      if (!assertSuccessOrSkipNetwork(t, result)) return;
      const { json } = result;
      assert.ok(json.wallet);
      assert.ok(json.portfolio);
      assert.ok(json.positions);
      assert.ok(json.pnl);
    });

    it("analyze works with ENS", { skip: SKIP ? SKIP_MSG : false }, async (t) => {
      const result = await run(["analyze", "vitalik.eth"]);
      if (!assertSuccessOrSkipNetwork(t, result)) return;
      const { json } = result;
      assert.equal(json.label, "vitalik.eth");
    });

    it("analyze with chain filter", { skip: SKIP ? SKIP_MSG : false }, async (t) => {
      const result = await run(["analyze", VITALIK, "--chain", "ethereum"]);
      if (!assertSuccessOrSkipNetwork(t, result)) return;
    });
  });

  describe("error handling", () => {
    it("invalid API key returns error", { skip: false }, async (t) => {
      const result = await new Promise((resolve) => {
        execFile(
          "node",
          [BIN, "pnl", VITALIK],
          { env: { ...process.env, ZERION_API_KEY: "zk_dev_invalid_key_12345" }, timeout: 15000 },
          (error, stdout, stderr) => {
            resolve({ code: error?.code ?? 0, stderr });
          }
        );
      });

      assert.equal(result.code, 1);
      // Node can emit deprecation warnings (e.g. DEP0040 punycode) ahead of
      // the CLI's JSON error output on stderr. Parse from the first '{'.
      const json = JSON.parse(result.stderr.slice(result.stderr.indexOf("{")));
      if (json.error.code === "pnl_error" && /fetch failed/i.test(json.error.message || "")) {
        t.skip("network unavailable for live invalid-key check");
        return;
      }
      assert.equal(json.error.code, "api_error");
    });
  });
});
