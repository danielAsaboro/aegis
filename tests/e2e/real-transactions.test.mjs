import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { Connection, SystemProgram, Transaction } from '@solana/web3.js';

import { getKeypair } from '../../engine/lib/keypair.mjs';
import { MagicBlockClient, getTokenMint } from '../../engine/lib/magicblock/client.mjs';
import {
  createRealTestEnvironment,
  setupRealTestEnv,
  runPreflightChecks,
  REAL_E2E_CONFIG,
} from './real-setup.mjs';

describe('E2E: Real Transactions with Your API Keys', () => {
  let testEnv;
  let restoreEnv;
  let keypair;
  let walletAddress;
  let suiteSkipReason = null;
  let connection;
  let zerionAuth;

  function formatSetupError(err) {
    return err?.message?.split('\n')[0] || err?.stack?.split('\n')[0] || err?.name || 'unknown setup failure';
  }

  before(async () => {
    console.log('[E2E REAL] Setting up with live credentials...');

    try {
      testEnv = await createRealTestEnvironment();
      restoreEnv = setupRealTestEnv(testEnv.testDir);
      keypair = getKeypair();
      walletAddress = keypair.publicKey.toBase58();
      connection = new Connection(REAL_E2E_CONFIG.SOLANA_RPC, 'confirmed');
      zerionAuth = `Basic ${Buffer.from(`${process.env.ZERION_API_KEY}:`).toString('base64')}`;
      await runPreflightChecks(keypair);
      console.log(`[E2E REAL] Wallet: ${walletAddress}`);
    } catch (err) {
      if (testEnv) testEnv.cleanup();
      if (restoreEnv) restoreEnv();
      suiteSkipReason = `real transaction preflight failed: ${formatSetupError(err)}`;
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

  it('Zerion chains and wallet lookup respond with real credentials', async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    const chainsResponse = await fetch('https://api.zerion.io/v1/chains', {
      headers: {
        Authorization: zerionAuth,
        'Content-Type': 'application/json',
      },
    });
    assert.ok(chainsResponse.ok, `Chains API failed: ${chainsResponse.status} ${chainsResponse.statusText}`);

    const chainsData = await chainsResponse.json();
    assert.ok(Array.isArray(chainsData.data));
    const solanaChain = chainsData.data.find((chain) =>
      chain.id === 'solana' ||
      chain.attributes?.external_id === 'solana' ||
      chain.attributes?.name?.toLowerCase().includes('solana')
    );
    assert.ok(solanaChain, 'Solana chain should be available');

    const walletResponse = await fetch(`https://api.zerion.io/v1/wallets/${walletAddress}`, {
      headers: {
        Authorization: zerionAuth,
        'Content-Type': 'application/json',
      },
    });
    assert.ok([200, 404].includes(walletResponse.status), `Unexpected wallet status: ${walletResponse.status}`);
  });

  it('broadcasts and confirms a real devnet self-transfer', async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    const { blockhash } = await connection.getLatestBlockhash();
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: keypair.publicKey,
        lamports: 1000,
      }),
    );
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = keypair.publicKey;
    transaction.sign(keypair);

    const signature = await connection.sendRawTransaction(transaction.serialize());
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');

    assert.ok(signature, 'transaction signature should be returned');
    assert.equal(confirmation.value.err, null);
  });

  it('reads live MagicBlock state for the configured wallet', async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    const client = new MagicBlockClient(keypair);
    const solMint = getTokenMint('SOL');
    const balance = await client.getShieldedBalance(solMint);
    const history = await client.getTransactionHistory({ limit: 5 });

    assert.equal(typeof balance, 'bigint');
    assert.ok(Array.isArray(history));
  });

  it('Telegram getMe succeeds for the configured bot token', async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`);
    const data = await response.json();

    assert.equal(data.ok, true, `Telegram API failed: ${data.description}`);
    assert.ok(data.result.username, 'bot username should be present');
  });

  it('environment summary contains the live configuration used by this suite', async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    assert.ok(walletAddress, 'wallet address should be available');
    assert.ok(process.env.ZERION_API_KEY, 'ZERION_API_KEY should be present');
    assert.ok(process.env.TELEGRAM_BOT_TOKEN, 'TELEGRAM_BOT_TOKEN should be present');
    assert.ok(process.env.MAGICBLOCK_RPC_URL, 'MAGICBLOCK_RPC_URL should be present');
    assert.ok(process.env.MAGICBLOCK_EPHEMERAL_URL, 'MAGICBLOCK_EPHEMERAL_URL should be present');
  });
});
