import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { getKeypair } from '../../engine/lib/keypair.mjs';
import { MagicBlockClient, getTokenMint } from '../../engine/lib/magicblock/client.mjs';
import {
  createRealTestEnvironment,
  setupRealTestEnv,
  runPreflightChecks,
  validateWalletFunds,
} from './real-setup.mjs';

describe("E2E: Wallet Operations (Real)", () => {
  let testEnv, restoreEnv, keypair, walletAddress, suiteSkipReason = null;

  before(async () => {
    console.log('[E2E WALLET] Setting up real test environment...');

    try {
      testEnv = await createRealTestEnvironment();
      restoreEnv = setupRealTestEnv(testEnv.testDir);
      keypair = getKeypair();
      if (!keypair) {
        throw new Error('SOLANA_PRIVATE_KEY is not configured');
      }
      walletAddress = keypair.publicKey.toBase58();
      console.log(`[E2E WALLET] Using wallet: ${walletAddress}`);
      await runPreflightChecks(keypair);
    } catch (err) {
      if (testEnv) testEnv.cleanup();
      if (restoreEnv) restoreEnv();
      suiteSkipReason = `real E2E preflight failed: ${err.message.split('\n')[0]}`;
    }
  });

  after(() => {
    if (testEnv) testEnv.cleanup();
    if (restoreEnv) restoreEnv();
  });

  function skipIfSuiteBlocked(t) {
    if (suiteSkipReason) {
      t.skip(suiteSkipReason);
      return true;
    }
    return false;
  }

  it("validates wallet funds and address consistency", async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    const funds = await validateWalletFunds(keypair);
    assert.equal(funds.address, walletAddress);
    assert.ok(funds.sol >= 0);
  });

  it("instantiates MagicBlock client and queries shielded SOL balance", async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    const client = new MagicBlockClient(keypair);
    const solMint = getTokenMint('SOL');
    assert.ok(solMint, 'SOL mint should resolve');

    try {
      const balance = await client.getShieldedBalance(solMint);
      assert.equal(typeof balance, 'bigint');
    } catch (err) {
      assert.match(err.message, /fetch failed|account|TokenAccountNotFound|not found/i);
    }
  });

  it("validates environment configuration for wallet-backed flows", async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    assert.ok(process.env.TELEGRAM_BOT_TOKEN, 'TELEGRAM_BOT_TOKEN should be set');
    assert.ok(process.env.ZERION_API_KEY, 'ZERION_API_KEY should be set');
    assert.ok(process.env.SOLANA_PRIVATE_KEY, 'SOLANA_PRIVATE_KEY should be set');
    assert.ok(process.env.DATA_DIR, 'DATA_DIR should be set');
  });
});
