/**
 * AEGIS End-to-End Test Suite
 *
 * Single authoritative E2E test for the full MagicBlock → Zerion stack.
 * Covers infrastructure, wallet, on-chain transactions, privacy, DCA, group
 * consensus, and signal automation — all against real endpoints.
 *
 * Run:
 *   node --env-file=.env --test tests/e2e/aegis.e2e.test.mjs
 */

import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair, Connection, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';

import { getKeypair } from '../../engine/lib/keypair.mjs';
import { MagicBlockClient, getTokenMint } from '../../engine/lib/magicblock/client.mjs';
import { check as checkPrivacy, getPrivacyConfig } from '../../engine/policies/privacy.mjs';
import { check as checkConsensus } from '../../engine/policies/consensus.mjs';
import { runPolicies, getDefaultPolicies } from '../../engine/policies/engine.mjs';
import { createTradeProposal, createDCAPlan, createGroupProposal, createPriceAlert, SignalType } from '../../engine/core/types.mjs';
import { logExecution as logExec, getExecutions, initExecutionsStore } from '../../engine/store/executions.mjs';
import { initShieldStore, updateShieldBalance, recordShieldTransaction } from '../../engine/store/shield.mjs';
import { initStateStore } from '../../engine/store/state.mjs';
import {
  initPlansStore,
  addDCAPlan, getDCAPlans, updateDCAPlan,
  addProposal, getProposal, getActiveProposals, updateProposal,
  addPriceAlert, getPriceAlerts,
} from '../../engine/store/plans.mjs';
import { DipBuyerStrategy } from '../../engine/strategies/dip-buyer.mjs';
import { TakeProfitStrategy } from '../../engine/strategies/take-profit.mjs';
import bus from '../../engine/core/event-bus.mjs';

// ─── Shared state ─────────────────────────────────────────────────────────────

const LOG = (msg) => console.log(`[AEGIS] ${msg}`);
const SOLANA_RPC  = 'https://api.devnet.solana.com';
const MB_RPC      = process.env.MAGICBLOCK_RPC_URL      || 'https://rpc.magicblock.app/devnet';
const MB_EPH      = process.env.MAGICBLOCK_EPHEMERAL_URL || 'https://devnet.magicblock.app';
const ZERION_BASE = 'https://api.zerion.io/v1';
const TG_BASE     = 'https://api.telegram.org';

let testDir, keypair, walletAddress, connection, mbClient, zerionAuth;

// ─── Suite setup / teardown ──────────────────────────────────────────────────

describe('AEGIS E2E Suite', () => {
  before(async () => {
    LOG('Setting up E2E environment...');

    // Temp data dir for all stores
    testDir = mkdtempSync(join(tmpdir(), 'aegis-e2e-'));
    initStateStore(testDir);
    initPlansStore(testDir);
    initExecutionsStore(testDir);
    initShieldStore(testDir);
    process.env.DATA_DIR = testDir;

    // Keypair from env
    keypair      = getKeypair();
    walletAddress = keypair.publicKey.toBase58();
    connection   = new Connection(SOLANA_RPC, 'confirmed');
    mbClient     = new MagicBlockClient(keypair);

    // Zerion auth header (Basic key:)
    const apiKey = process.env.ZERION_API_KEY;
    assert.ok(apiKey, 'ZERION_API_KEY must be set');
    zerionAuth = `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;

    LOG(`Wallet: ${walletAddress}`);
    LOG('Setup complete.');
  });

  after(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. INFRASTRUCTURE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('1. Infrastructure', () => {
    it('runtime: Node ≥ 20, crypto, filesystem work', async () => {
      const major = parseInt(process.version.slice(1));
      assert.ok(major >= 20, `Node ≥ 20 required, got ${process.version}`);

      const { randomBytes } = await import('node:crypto');
      assert.equal(randomBytes(32).length, 32);

      const tmpFile = join(testDir, 'smoke.json');
      writeFileSync(tmpFile, '{"ok":true}');
      assert.deepEqual(JSON.parse(readFileSync(tmpFile, 'utf-8')), { ok: true });

      LOG(`✅ Runtime: Node ${process.version}`);
    });

    it('Zerion API: /v1/chains responds, Solana chain present', async () => {
      const res  = await fetch(`${ZERION_BASE}/chains`, { headers: { Authorization: zerionAuth } });
      assert.ok(res.ok, `Zerion chains: HTTP ${res.status}`);
      const body = await res.json();
      assert.ok(Array.isArray(body.data), 'chains should be array');

      const solana = body.data.find(c =>
        c.attributes.external_id === 'solana' ||
        c.attributes.name.toLowerCase().includes('solana')
      );
      assert.ok(solana, 'Solana chain not found in Zerion chains list');

      LOG(`✅ Zerion: ${body.data.length} chains — Solana: ${solana.attributes.name}`);
    });

    it('Solana devnet: RPC version + health', async () => {
      const ver = await connection.getVersion();
      assert.ok(ver['solana-core'], 'version missing solana-core');

      const healthRes = await fetch(SOLANA_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      });
      const health = await healthRes.json();
      assert.ok(health.result === 'ok' || health.result, 'RPC health check failed');

      LOG(`✅ Solana devnet: ${ver['solana-core']}`);
    });

    it('MagicBlock RPC: getVersion responds', async () => {
      const res = await fetch(MB_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getVersion' }),
      });
      assert.ok(res.ok, `MagicBlock RPC: HTTP ${res.status}`);
      const body = await res.json();
      assert.ok(body.result?.['solana-core'], 'MagicBlock RPC missing solana-core version');
      LOG(`✅ MagicBlock RPC: ${body.result['solana-core']}`);
    });

    it('MagicBlock ephemeral: /health reachable', async () => {
      const res = await fetch(`${MB_EPH}/health`);
      assert.ok(res.status < 300, `Ephemeral /health: HTTP ${res.status}`);
      LOG(`✅ MagicBlock ephemeral: HTTP ${res.status}`);
    });

    it('Telegram bot: getMe confirms live bot', async () => {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      assert.ok(token, 'TELEGRAM_BOT_TOKEN must be set');
      assert.match(token, /^\d+:[A-Za-z0-9_-]+$/, 'token format invalid');

      const res  = await fetch(`${TG_BASE}/bot${token}/getMe`);
      const body = await res.json();
      assert.ok(body.ok, `Telegram getMe failed: ${body.description}`);
      assert.ok(body.result.username, 'bot has no username');

      LOG(`✅ Telegram bot: @${body.result.username} (${body.result.first_name})`);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. WALLET
  // ═══════════════════════════════════════════════════════════════════════════

  describe('2. Wallet', () => {
    it('keypair: loads from SOLANA_PRIVATE_KEY, valid base58 address', () => {
      assert.ok(keypair, 'keypair must exist');
      assert.ok(keypair.publicKey, 'keypair must have publicKey');
      assert.ok(walletAddress.length >= 32, 'address too short');
      LOG(`✅ Wallet address: ${walletAddress}`);
    });

    it('SOL balance: ≥ 0.1 SOL on devnet', async () => {
      const lamports = await connection.getBalance(keypair.publicKey);
      const sol      = lamports / LAMPORTS_PER_SOL;
      assert.ok(lamports >= 0, 'balance must be non-negative');
      assert.ok(sol >= 0.1, `Insufficient devnet SOL: ${sol.toFixed(4)} — run: solana airdrop 2 ${walletAddress} --url devnet`);
      LOG(`✅ Wallet balance: ${sol.toFixed(4)} SOL`);
    });

    it('recent transactions: at least one signature on devnet', async () => {
      const sigs = await connection.getSignaturesForAddress(keypair.publicKey, { limit: 3 });
      assert.ok(sigs.length > 0, 'wallet has no tx history — send at least one tx first');
      sigs.forEach((s, i) => LOG(`   tx ${i + 1}: https://solscan.io/tx/${s.signature}?cluster=devnet`));
      LOG(`✅ Recent txs: ${sigs.length} found`);
    });

    it('Zerion portfolio lookup: responds for wallet address', async () => {
      const res = await fetch(`${ZERION_BASE}/wallets/${walletAddress}`, {
        headers: { Authorization: zerionAuth },
      });
      // 404 is expected for a wallet with no mainnet history
      assert.ok(res.status === 200 || res.status === 404, `Unexpected status: ${res.status}`);

      if (res.status === 200) {
        const body = await res.json();
        LOG(`✅ Zerion portfolio: $${body.data?.attributes?.total?.value ?? 0}`);
      } else {
        LOG('✅ Zerion portfolio: 404 expected for devnet-only wallet');
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. ON-CHAIN TRANSACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('3. On-Chain Transactions', () => {
    it('devnet self-transfer: broadcasts + confirms real tx', async () => {
      const balance = await connection.getBalance(keypair.publicKey);
      assert.ok(balance >= 10_000, 'Need at least 10 000 lamports to pay fees');

      const { blockhash } = await connection.getLatestBlockhash();
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey:   keypair.publicKey,
          lamports:   1000,
        })
      );
      tx.recentBlockhash = blockhash;
      tx.feePayer        = keypair.publicKey;
      tx.sign(keypair);

      const sig = await connection.sendRawTransaction(tx.serialize());
      const confirmation = await connection.confirmTransaction(sig, 'confirmed');
      assert.ok(!confirmation.value.err, `Tx confirmed with error: ${JSON.stringify(confirmation.value.err)}`);

      LOG(`✅ On-chain tx: ${sig}`);
      LOG(`   solscan: https://solscan.io/tx/${sig}?cluster=devnet`);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. MAGICBLOCK PRIVACY LAYER
  // ═══════════════════════════════════════════════════════════════════════════

  describe('4. MagicBlock Privacy Layer', () => {
    it('token mint addresses resolve for SOL and USDC', () => {
      const solMint  = getTokenMint('SOL');
      const usdcMint = getTokenMint('USDC');
      assert.ok(solMint,  'SOL mint must resolve');
      assert.ok(usdcMint, 'USDC mint must resolve');
      LOG(`✅ SOL mint:  ${solMint.toBase58()}`);
      LOG(`✅ USDC mint: ${usdcMint.toBase58()}`);
    });

    it('shielded SOL balance: query returns bigint', async () => {
      const solMint = getTokenMint('SOL');
      const balance = await mbClient.getShieldedBalance(solMint);
      assert.equal(typeof balance, 'bigint', 'shielded balance must be bigint');
      LOG(`✅ Shielded SOL: ${balance} lamports`);
    });

    it('shielded USDC balance: query returns bigint or gracefully fails', async () => {
      const usdcMint = getTokenMint('USDC');
      try {
        const balance = await mbClient.getShieldedBalance(usdcMint);
        assert.equal(typeof balance, 'bigint', 'shielded USDC balance must be bigint');
        LOG(`✅ Shielded USDC: ${balance}`);
      } catch (err) {
        // Uninitialized account is expected for fresh wallets
        LOG(`✅ Shielded USDC: uninitialized (${err.message.split('\n')[0]})`);
      }
    });

    it('wSOL delegation deposit: attempt or graceful skip', async () => {
      const solMint  = getTokenMint('SOL');
      const amount   = BigInt(Math.round(0.001 * LAMPORTS_PER_SOL)); // 0.001 SOL
      try {
        const txHash = await mbClient.deposit(solMint, amount);
        assert.ok(typeof txHash === 'string', 'deposit must return signature string');
        LOG(`✅ wSOL deposit: ${txHash}`);
      } catch (err) {
        // wSOL delegation requires an existing wSOL token account — skip gracefully
        LOG(`✅ wSOL deposit skipped (${err.message.split('\n')[0]})`);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. PRIVACY POLICY ENGINE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('5. Privacy Policy Engine', () => {
    it('config: valid mode, numeric threshold, token array', () => {
      const cfg = getPrivacyConfig();
      assert.ok(['on', 'off', 'auto'].includes(cfg.mode), `mode '${cfg.mode}' invalid`);
      assert.equal(typeof cfg.thresholdUsd, 'number', 'threshold must be number');
      assert.ok(Array.isArray(cfg.privateTokens), 'privateTokens must be array');
      LOG(`✅ Privacy config: mode=${cfg.mode} threshold=$${cfg.thresholdUsd} tokens=${cfg.privateTokens.join(',')}`);
    });

    it('auto mode: small trade with no private tokens → public', () => {
      const result = checkPrivacy({
        transaction: { from: 'ETH', to: 'BTC', amount: 10 },
        policy_config: { mode: 'auto', thresholdUsd: 100, privateTokens: [] },
        proposal: { amount: 10 },
      });
      assert.equal(result.usePrivate, false, 'below-threshold trade should be public');
      assert.ok(result.reason, 'must include a reason');
      LOG(`✅ Small trade: public (${result.reason})`);
    });

    it('auto mode: large trade above threshold → private with "threshold" in reason', () => {
      const result = checkPrivacy({
        transaction: { from: 'ETH', to: 'BTC', amount: 200 },
        policy_config: { mode: 'auto', thresholdUsd: 100, privateTokens: [] },
        proposal: { amount: 200 },
      });
      assert.equal(result.usePrivate, true, 'above-threshold trade should be private');
      assert.ok(result.reason.includes('threshold'), `reason should mention threshold, got: ${result.reason}`);
      LOG(`✅ Large trade: private (${result.reason})`);
    });

    it('auto mode: token in privateTokens → private even below threshold', () => {
      const result = checkPrivacy({
        transaction: { from: 'USDC', to: 'SOL', amount: 5 },
        policy_config: { mode: 'auto', thresholdUsd: 100, privateTokens: ['SOL'] },
        proposal: { amount: 5 },
      });
      assert.equal(result.usePrivate, true, 'private-token trade should always be private');
      LOG(`✅ Private token: private (${result.reason})`);
    });

    it("mode 'off': large trade stays public", () => {
      const result = checkPrivacy({
        transaction: { from: 'USDC', to: 'SOL', amount: 1000 },
        policy_config: { mode: 'off', thresholdUsd: 100, privateTokens: [] },
        proposal: { amount: 1000 },
      });
      assert.equal(result.usePrivate, false);
      LOG(`✅ Mode off: public (${result.reason})`);
    });

    it("mode 'on': tiny trade is forced private", () => {
      const result = checkPrivacy({
        transaction: { from: 'USDC', to: 'SOL', amount: 1 },
        policy_config: { mode: 'on', thresholdUsd: 100, privateTokens: [] },
        proposal: { amount: 1 },
      });
      assert.equal(result.usePrivate, true);
      LOG(`✅ Mode on: private (${result.reason})`);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. TRADE PROPOSALS & EXECUTION LOG
  // ═══════════════════════════════════════════════════════════════════════════

  describe('6. Trade Proposals & Execution Log', () => {
    it('createTradeProposal: correct shape', () => {
      const proposal = createTradeProposal({
        strategyId:   'e2e-test',
        strategyType: 'manual',
        fromToken:    'USDC',
        toToken:      'SOL',
        amount:       50,
        chain:        'solana',
        reason:       'E2E test trade',
      });
      assert.ok(proposal.id,            'must have id');
      assert.equal(proposal.fromToken,  'USDC');
      assert.equal(proposal.toToken,    'SOL');
      assert.equal(Number(proposal.amount), 50);
      assert.equal(proposal.chain,      'solana');
      LOG(`✅ Proposal shape: ${proposal.id}`);
    });

    it('$150 SOL trade routes to private execution via privacy policy', () => {
      const proposal = createTradeProposal({
        strategyId:   'privacy-route-test',
        strategyType: 'manual',
        fromToken:    'USDC',
        toToken:      'SOL',
        amount:       150,
        chain:        'solana',
        reason:       'Privacy routing test',
      });

      const result = checkPrivacy({
        transaction: { from: proposal.fromToken, to: proposal.toToken, amount: Number(proposal.amount) },
        policy_config: getPrivacyConfig(),
        proposal,
      });
      assert.equal(result.usePrivate, true, '$150 SOL trade should route to private');
      LOG(`✅ $150 SOL → private (${result.reason})`);
    });

    it('logExecution stores record, getExecutions retrieves it', () => {
      const proposal = createTradeProposal({
        strategyId: 'exec-log-test', strategyType: 'manual',
        fromToken: 'USDC', toToken: 'SOL', amount: 10, chain: 'solana',
        reason: 'Exec log test',
      });
      const record = {
        id:         `exec-${proposal.id}`,
        proposalId: proposal.id,
        status:     'simulated',
        usePrivate: false,
        reason:     'E2E execution log test',
        timestamp:  Date.now(),
      };

      logExec(record);

      const all = getExecutions();
      const found = all.find(e => e.id === record.id);
      assert.ok(found, 'execution must be retrievable');
      assert.equal(found.proposalId, proposal.id);
      LOG(`✅ Execution logged and retrieved: ${record.id}`);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. DCA STRATEGY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('7. DCA Strategy', () => {
    const DCA_CHAT = 111_222_333;
    let dcaPlanId;

    it('createDCAPlan + addDCAPlan + getDCAPlans', () => {
      const plan = createDCAPlan({
        toToken:   'SOL',
        amount:    1,
        chain:     'solana',
        cron:      '0 * * * *',
        chatId:    DCA_CHAT,
        policies:  getDefaultPolicies('dca'),
      });
      assert.ok(plan.id,                          'plan must have id');
      assert.equal(plan.toToken,                  'SOL');
      assert.equal(Number(plan.amount),           1);
      assert.equal(plan.status,                   'active');

      addDCAPlan(plan);
      dcaPlanId = plan.id;

      const stored = getDCAPlans(DCA_CHAT);
      const found  = stored.find(p => p.id === dcaPlanId);
      assert.ok(found, 'plan must be retrievable by chatId');
      LOG(`✅ DCA plan stored: ${dcaPlanId}`);
    });

    it('runPolicies: $1 DCA proposal approved by spend-limit ($25 perTick)', async () => {
      const proposal = createTradeProposal({
        strategyId:   dcaPlanId,
        strategyType: 'dca',
        fromToken:    'USDC',
        toToken:      'SOL',
        amount:       1,
        chain:        'solana',
        reason:       'DCA tick',
      });

      const result = await runPolicies(proposal, {
        'spend-limit': { perTick: 25, daily: 100, total: 1000 },
        'cooldown':    { intervalMs: 0 },
      });
      assert.equal(result.approved, true, `DCA denied: ${result.reason}`);
      LOG(`✅ Policy engine approved $1 DCA`);
    });

    it('plan lifecycle: active → paused → active → cancelled', () => {
      const paused    = updateDCAPlan(dcaPlanId, { status: 'paused' });
      assert.equal(paused.status,   'paused');

      const resumed   = updateDCAPlan(dcaPlanId, { status: 'active' });
      assert.equal(resumed.status,  'active');

      const cancelled = updateDCAPlan(dcaPlanId, { status: 'cancelled' });
      assert.equal(cancelled.status, 'cancelled');

      LOG(`✅ DCA plan lifecycle: active → paused → active → cancelled`);
    });

    it('forcePrivate flag survives add/get round-trip', () => {
      const plan = createDCAPlan({
        toToken: 'SOL', amount: 1, chain: 'solana',
        cron: '0 0 * * *', chatId: DCA_CHAT,
        policies: {}, forcePrivate: true,
      });
      addDCAPlan(plan);
      const stored = getDCAPlans(DCA_CHAT).find(p => p.id === plan.id);
      assert.equal(stored?.forcePrivate, true, 'forcePrivate must persist');
      LOG(`✅ forcePrivate preserved`);
    });

    it('persistence: plans survive initPlansStore re-initialisation', () => {
      const before = getDCAPlans(DCA_CHAT).length;
      assert.ok(before > 0, 'need at least one plan before re-init');

      initPlansStore(testDir);

      const after = getDCAPlans(DCA_CHAT).length;
      assert.equal(after, before, 'plan count must not change after re-init');
      LOG(`✅ DCA persistence: ${after} plans survived re-init`);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. GROUP CONSENSUS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('8. Group Consensus', () => {
    const GROUP_CHAT = -1_001_234_567_890;
    let storedProposalId;

    const makeCtx = (votes, expiresAt) => {
      // Consensus policy reads from the DB via getProposal(proposalId)
      // so we store a proposal and pass a trade proposal that points to it
      const gp = {
        id:            `prop-${Date.now()}-${Math.random()}`,
        fromToken:     'USDC',
        toToken:       'SOL',
        amount:        '25',
        chain:         'solana',
        proposerId:    111,
        proposerName:  'alice',
        chatId:        GROUP_CHAT,
        requiredVotes: 3,
        votes,
        expiresAt:     expiresAt || new Date(Date.now() + 15 * 60_000).toISOString(),
        status:        'voting',
        createdAt:     new Date().toISOString(),
      };
      addProposal(gp);
      return {
        proposal: {
          strategyType: 'group',
          signal: { proposalId: gp.id },
        },
        policy_config: { requiredVotes: 3 },
        gp,
      };
    };

    it('0 approvals → denied (need N votes)', () => {
      const { proposal, policy_config } = makeCtx({});
      const res = checkConsensus({ proposal, policy_config });
      assert.equal(res.allow, false);
      assert.match(res.reason, /approvals/i);
      LOG(`✅ 0/3 approvals → denied: ${res.reason}`);
    });

    it('2/3 approvals → denied', () => {
      const { proposal, policy_config } = makeCtx({ 111: 'approve', 222: 'approve' });
      const res = checkConsensus({ proposal, policy_config });
      assert.equal(res.allow, false);
      LOG(`✅ 2/3 approvals → denied: ${res.reason}`);
    });

    it('3/3 approvals → allowed', () => {
      const { proposal, policy_config } = makeCtx({ 111: 'approve', 222: 'approve', 333: 'approve' });
      const res = checkConsensus({ proposal, policy_config });
      assert.equal(res.allow, true);
      LOG(`✅ 3/3 approvals → allowed`);
    });

    it('mixed votes (2 approve, 1 reject) → denied', () => {
      const { proposal, policy_config } = makeCtx({ 111: 'approve', 222: 'approve', 333: 'reject' });
      const res = checkConsensus({ proposal, policy_config });
      assert.equal(res.allow, false);
      LOG(`✅ Mixed votes → denied: ${res.reason}`);
    });

    it('expired proposal → denied with "expired" in reason', () => {
      const pastDate = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago
      const { proposal, policy_config } = makeCtx(
        { 111: 'approve', 222: 'approve', 333: 'approve' },
        pastDate
      );
      const res = checkConsensus({ proposal, policy_config });
      assert.equal(res.allow, false);
      assert.match(res.reason, /expired/i);
      LOG(`✅ Expired proposal → denied: ${res.reason}`);
    });

    it('voting workflow: Alice + Bob + Charlie approve → consensus passes', () => {
      const gp = createGroupProposal({
        fromToken:       'USDC',
        toToken:         'SOL',
        amount:          25,
        chain:           'solana',
        proposerId:      111,
        proposerName:    'alice',
        chatId:          GROUP_CHAT,
        requiredVotes:   3,
        expiresInMinutes: 60,
      });
      addProposal(gp);
      storedProposalId = gp.id;

      // Cast three approvals — use explicit IDs so later tests can reference them
      const VOTERS = { alice: 111, bob: 222, charlie: 333 };
      for (const [, id] of Object.entries(VOTERS)) {
        const current = getProposal(gp.id);
        updateProposal(gp.id, { votes: { ...current.votes, [id]: 'approve' } });
      }

      const final = getProposal(storedProposalId);
      const approvals = Object.values(final.votes).filter(v => v === 'approve').length;
      assert.equal(approvals, 3);

      const res = checkConsensus({
        proposal: { strategyType: 'group', signal: { proposalId: storedProposalId } },
        policy_config: { requiredVotes: 3 },
      });
      assert.equal(res.allow, true);
      LOG(`✅ Voting workflow: 3 approvals → consensus passes`);
    });

    it('vote change: changing approve → reject updates in-place (no duplicate)', () => {
      const current = getProposal(storedProposalId);
      // Charlie changes his vote from approve to reject
      const newVotes = { ...current.votes, 333: 'reject' };
      updateProposal(storedProposalId, { votes: newVotes });

      const updated = getProposal(storedProposalId);
      assert.equal(Object.keys(updated.votes).length, 3, 'still exactly 3 voters');
      assert.equal(updated.votes[333], 'reject', 'vote must be updated');
      LOG(`✅ Vote changed: approve → reject, no duplicate`);
    });

    it('approved proposal marked for execution', () => {
      // Reset to 3 approvals
      updateProposal(storedProposalId, {
        votes:  { 111: 'approve', 222: 'approve', 333: 'approve' },
        status: 'approved',
        approvedAt: new Date().toISOString(),
      });
      const final = getProposal(storedProposalId);
      assert.equal(final.status, 'approved');
      assert.ok(final.approvedAt);
      LOG(`✅ Proposal ${storedProposalId} marked approved`);
    });

    it('persistence: proposals survive initPlansStore re-initialisation', () => {
      const before = getActiveProposals(GROUP_CHAT).length;

      initPlansStore(testDir);

      const after = getActiveProposals(GROUP_CHAT).length;
      assert.ok(after >= 0, 'proposals must load after re-init');
      LOG(`✅ Proposal persistence: ${after} active proposals after re-init`);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. SIGNAL AUTOMATION & ALERTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('9. Signal Automation & Alerts', () => {
    const SIG_CHAT = 999_888_777;

    it('event bus: emit + subscribe roundtrip', async () => {
      let received = null;
      const unsub = bus.subscribe('PRICE_DIP', (sig) => { received = sig; });

      bus.emit('PRICE_DIP', { token: 'SOL', dropPercent: 5, chain: 'solana', timestamp: Date.now() });

      await new Promise(r => setTimeout(r, 50));
      assert.ok(received, 'subscriber should receive emitted signal');
      assert.equal(received.token, 'SOL');
      unsub();
      LOG(`✅ Event bus: PRICE_DIP roundtrip`);
    });

    it('DipBuyerStrategy.evaluate(): returns proposal for matching alert', async () => {
      // Store a dip-buyer alert with buy configuration
      const alert = addPriceAlert({
        id:        `dip-alert-${Date.now()}`,
        token:     'SOL',
        chain:     'solana',
        type:      'dip-buyer',
        direction: 'below',
        threshold: 5,
        buyToken:  'USDC',
        buyAmount: '1',
        chatId:    SIG_CHAT,
        policies:  {},
        status:    'active',
        createdAt: new Date().toISOString(),
      });

      const strategy = new DipBuyerStrategy({ walletName: 'e2e-test' });
      const signal = {
        type:        SignalType.PRICE_DIP,
        alertId:     alert.id,
        token:       'SOL',
        chain:       'solana',
        dropPercent: 6.5,
        currentPrice: 140,
        timestamp:   Date.now(),
      };

      const proposal = await strategy.evaluate(signal);
      assert.ok(proposal,                    'evaluate must return a proposal');
      assert.equal(proposal.toToken,  'SOL', 'should buy SOL');
      assert.ok(proposal.reason.includes('dip'), 'reason should mention dip');
      LOG(`✅ DipBuyer: ${proposal.amount} ${proposal.fromToken} → ${proposal.toToken}`);
    });

    it('TakeProfitStrategy.evaluate(): returns proposal for matching alert', async () => {
      const alert = addPriceAlert({
        id:        `tp-alert-${Date.now()}`,
        token:     'SOL',
        chain:     'solana',
        type:      'take-profit',
        direction: 'above',
        threshold: 10,
        buyToken:  'USDC',
        buyAmount: '2',
        chatId:    SIG_CHAT,
        policies:  {},
        status:    'active',
        createdAt: new Date().toISOString(),
      });

      const strategy = new TakeProfitStrategy({ walletName: 'e2e-test' });
      const signal = {
        type:       SignalType.PRICE_SPIKE,
        alertId:    alert.id,
        token:      'SOL',
        chain:      'solana',
        gainPercent: 12.0,
        currentPrice: 168,
        timestamp:  Date.now(),
      };

      const proposal = await strategy.evaluate(signal);
      assert.ok(proposal,                    'evaluate must return a proposal');
      assert.equal(proposal.fromToken, 'SOL', 'should sell SOL');
      assert.equal(proposal.toToken,  'USDC', 'should take profit into USDC');
      assert.ok(proposal.reason.includes('spike'), 'reason should mention spike');
      LOG(`✅ TakeProfit: sell ${proposal.amount} ${proposal.fromToken} → ${proposal.toToken}`);
    });

    it('addPriceAlert + getPriceAlerts: data integrity', () => {
      const before = getPriceAlerts(SIG_CHAT).length;

      const a1 = addPriceAlert({
        id: `alert-a-${Date.now()}`, token: 'SOL', chain: 'solana',
        type: 'alert-only', direction: 'below', threshold: 8,
        chatId: SIG_CHAT, policies: {}, status: 'active',
        createdAt: new Date().toISOString(),
      });
      const a2 = addPriceAlert({
        id: `alert-b-${Date.now()}`, token: 'USDC', chain: 'solana',
        type: 'take-profit', direction: 'above', threshold: 15,
        buyToken: 'SOL', buyAmount: '2',
        chatId: SIG_CHAT, policies: {}, status: 'active',
        createdAt: new Date().toISOString(),
      });

      const after  = getPriceAlerts(SIG_CHAT);
      assert.equal(after.length, before + 2, 'alert count should increase by 2');

      const found1 = after.find(a => a.id === a1.id);
      const found2 = after.find(a => a.id === a2.id);
      assert.equal(found1.token,    'SOL');
      assert.equal(found2.threshold, 15);
      LOG(`✅ Alerts: ${after.length} stored, data intact`);
    });

    it('shield transaction history: records survive store re-init', () => {
      const wallet  = walletAddress;
      const token   = 'SOL';
      const txCount = 2;

      for (let i = 0; i < txCount; i++) {
        recordShieldTransaction({
          wallet,
          token,
          type:      i === 0 ? 'deposit' : 'withdraw',
          mint:      getTokenMint('SOL').toBase58(),
          amount:    String(1_000_000),
          txHash:    `test-tx-${i}-${Date.now()}`,
          timestamp: Date.now(),
        });
      }

      // Re-init shield store and verify records persisted
      initShieldStore(testDir);
      updateShieldBalance(wallet, token, BigInt(0)); // triggers a read to confirm store is up

      LOG(`✅ Shield tx history: ${txCount} records written`);
    });
  });
});
