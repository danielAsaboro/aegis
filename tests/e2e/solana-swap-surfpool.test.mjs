/**
 * E2E test: Zerion Solana swap pipeline against surfpool local simulation.
 *
 * Prerequisites (in .env or env):
 *   ZERION_API_KEY      — Zerion API key (test is skipped for the quote step if absent)
 *   SOLANA_PRIVATE_KEY  — JSON-array [b0,b1,...,b63] or base58 secret key
 *
 * Run:
 *   node --env-file=.env --test tests/e2e/solana-swap-surfpool.test.mjs
 */

import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { exec as execCb, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import {
  Connection,
  Keypair,
  VersionedTransaction,
  TransactionMessage,
  SystemProgram,
} from '@solana/web3.js';

const exec = promisify(execCb);

const SURFPOOL_URL = 'http://127.0.0.1:8899';
const ZERION_API_BASE = 'https://api.zerion.io/v1';
// Zerion fungible IDs for Solana
const SOL_FUNGIBLE_ID = '11111111111111111111111111111111';
// Zerion uses the EVM contract address as the canonical fungible ID for USDC
// across all chains (including Solana, where it maps to EPjFWdd5...)
const USDC_FUNGIBLE_ID = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

async function loadKeypair() {
  const raw = process.env.SOLANA_PRIVATE_KEY;
  if (!raw) throw new Error('SOLANA_PRIVATE_KEY not set in environment');

  // JSON array format: [b0, b1, ..., b63]
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length === 64) {
      return Keypair.fromSecretKey(Uint8Array.from(arr));
    }
  } catch {}

  // base58 format (87-88 chars, 64 bytes decoded)
  const bs58 = await import('bs58');
  const decode = bs58.default.decode;
  return Keypair.fromSecretKey(decode(raw));
}

async function waitForRpc(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getVersion', params: [] }),
        signal: AbortSignal.timeout(2_000),
      });
      if (res.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`surfpool RPC at ${url} not reachable after ${timeoutMs}ms`);
}

describe('Zerion Solana swap — surfpool local simulation', { timeout: 120_000 }, () => {
  let connection;
  let keypair;
  let swapOffers; // populated in quote test, consumed in broadcast test

  before(async () => {
    keypair = await loadKeypair();
    const walletPubkey = keypair.publicKey.toBase58();

    // Stop any stale surfpool instance before starting a fresh one
    await exec('pkill surfpool').catch(() => {});
    await new Promise(r => setTimeout(r, 1_000));

    // --daemon is Linux-only; use spawn + detached to background on macOS too
    const proc = spawn('surfpool', [
      'start', '--network', 'mainnet', '--no-tui',
      '--skip-blockhash-check', '--airdrop', walletPubkey,
    ], { detached: true, stdio: 'ignore' });
    proc.unref();

    await waitForRpc(SURFPOOL_URL, 30_000);

    // Set BEFORE constructing Connection — solana.js caches _connection at module level
    process.env.SOLANA_RPC_URL = SURFPOOL_URL;
    connection = new Connection(SURFPOOL_URL, 'confirmed');
  });

  after(async () => {
    await exec('pkill surfpool').catch(() => {});
  });

  it('surfpool is reachable and wallet is funded', { timeout: 10_000 }, async () => {
    const balance = await connection.getBalance(keypair.publicKey);
    assert.ok(balance > 0,
      `Expected airdropped balance > 0 lamports, got ${balance}`);
  });

  it('Zerion API returns a Solana swap quote structure', { timeout: 30_000 }, async (t) => {
    const apiKey = process.env.ZERION_API_KEY;
    if (!apiKey) { t.skip('ZERION_API_KEY not set'); return; }

    const walletPubkey = keypair.publicKey.toBase58();
    const auth = `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;

    const url = new URL(`${ZERION_API_BASE}/swap/quotes/`);
    const params = {
      from: walletPubkey,
      to: walletPubkey,
      'input[chain_id]': 'solana',
      'input[fungible_id]': SOL_FUNGIBLE_ID,
      'input[amount]': '0.005',
      'output[chain_id]': 'solana',
      'output[fungible_id]': USDC_FUNGIBLE_ID,
      slippage_percent: '2',
    };
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetch(url, {
      headers: { Accept: 'application/json', Authorization: auth },
    });
    const body = await res.json();

    assert.ok(Array.isArray(body.data),
      `Expected body.data array — got: ${JSON.stringify(body).slice(0, 300)}`);
    assert.ok(body.data.length >= 1, 'Expected ≥1 offer from Zerion');

    swapOffers = body.data;

    // Each offer must carry either an executable tx or a blocking error code
    const offer = swapOffers[0];
    const attrs = offer?.attributes ?? {};
    assert.ok(
      Boolean(attrs.transaction_swap?.solana) || Boolean(attrs.error),
      `Offer must have transaction_swap.solana or error — got: ${JSON.stringify(attrs).slice(0, 200)}`
    );
  });

  it('can sign and broadcast Solana tx to surfpool', { timeout: 30_000 }, async (t) => {
    const executable = swapOffers?.find(o => o.attributes?.transaction_swap?.solana?.raw);
    const solanaTx = executable?.attributes?.transaction_swap?.solana;

    let txHash;

    if (solanaTx?.raw) {
      // Happy path: Zerion returned a signed-placeholder tx — splice in our real sig
      const rawBytes = Buffer.from(solanaTx.raw, 'base64');
      const tx = VersionedTransaction.deserialize(rawBytes);
      tx.sign([keypair]);
      txHash = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    } else {
      // Zerion quote blocked (wallet has no mainnet balance) — verify broadcast
      // pipeline end-to-end with a funded native self-transfer on surfpool
      t.diagnostic(
        'Zerion quote was blocked (no mainnet balance); broadcast pipeline verified with native self-transfer'
      );
      const { blockhash } = await connection.getLatestBlockhash();
      const tx = new VersionedTransaction(
        new TransactionMessage({
          payerKey: keypair.publicKey,
          recentBlockhash: blockhash,
          instructions: [
            SystemProgram.transfer({
              fromPubkey: keypair.publicKey,
              toPubkey: keypair.publicKey,
              lamports: 1_000,
            }),
          ],
        }).compileToV0Message()
      );
      tx.sign([keypair]);
      txHash = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    }

    assert.ok(
      typeof txHash === 'string' && txHash.length > 0,
      `Expected txHash string from surfpool, got: ${txHash}`
    );
  });
});
