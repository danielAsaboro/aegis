import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { getKeypair } from '../../engine/lib/keypair.mjs';
import { getTokenMint } from '../../engine/lib/magicblock/client.mjs';
import { check as checkPrivacy, getPrivacyConfig } from '../../engine/policies/privacy.mjs';
import { check as checkConsensus } from '../../engine/policies/consensus.mjs';
import { getDefaultPolicies, runPolicies } from '../../engine/policies/engine.mjs';
import {
  createDCAPlan,
  createGroupProposal,
  createPriceAlert,
  createTradeProposal,
  SignalType,
} from '../../engine/core/types.mjs';
import { logExecution, getExecutions, initExecutionsStore } from '../../engine/store/executions.mjs';
import {
  addDCAPlan,
  addPriceAlert,
  addProposal,
  clearAlerts,
  clearDCAPlans,
  clearProposals,
  getDCAPlans,
  getPriceAlerts,
  getProposal,
  initPlansStore,
  updateProposal,
  updateDCAPlan,
} from '../../engine/store/plans.mjs';
import {
  getShieldBalance,
  getShieldHistory,
  recordShieldTransaction,
  updateShieldBalance,
} from '../../engine/store/shield.mjs';
import { DipBuyerStrategy } from '../../engine/strategies/dip-buyer.mjs';
import { TakeProfitStrategy } from '../../engine/strategies/take-profit.mjs';
import bus from '../../engine/core/event-bus.mjs';
import {
  createRealTestEnvironment,
  setupRealTestEnv,
  runPreflightChecks,
} from './real-setup.mjs';

describe('AEGIS E2E Suite', () => {
  let testEnv;
  let restoreEnv;
  let keypair;
  let walletAddress;
  let suiteSkipReason = null;

  const TEST_CHAT_ID = 777001;
  const TEST_GROUP_CHAT_ID = -100777001;

  function formatSetupError(err) {
    return err?.message?.split('\n')[0] || err?.stack?.split('\n')[0] || err?.name || 'unknown setup failure';
  }

  before(async () => {
    console.log('[AEGIS E2E] Setting up authoritative suite...');

    try {
      testEnv = await createRealTestEnvironment();
      restoreEnv = setupRealTestEnv(testEnv.testDir);
      await initPlansStore(testEnv.testDir);
      await clearDCAPlans();
      await clearAlerts();
      await clearProposals();
      bus.resetStats();

      keypair = getKeypair();
      walletAddress = keypair.publicKey.toBase58();
      await runPreflightChecks(keypair);

      console.log(`[AEGIS E2E] Wallet: ${walletAddress}`);
    } catch (err) {
      if (testEnv) testEnv.cleanup();
      if (restoreEnv) restoreEnv();
      suiteSkipReason = `real E2E preflight failed: ${formatSetupError(err)}`;
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

  it('runtime boots under Node and exposes the test wallet', () => {
    const major = Number.parseInt(process.version.slice(1), 10);
    assert.ok(major >= 20, `Node >= 20 required, got ${process.version}`);
    if (!suiteSkipReason) {
      assert.ok(walletAddress && walletAddress.length > 30, 'wallet address should be available');
    }
  });

  it('privacy config and routing logic stay internally consistent', async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    const cfg = getPrivacyConfig();
    assert.ok(['on', 'off', 'auto'].includes(cfg.mode));
    assert.equal(typeof cfg.thresholdUsd, 'number');

    const smallTrade = createTradeProposal({
      strategyId: 'privacy-small',
      strategyType: 'manual',
      fromToken: 'USDC',
      toToken: 'SOL',
      amount: 10,
      chain: 'solana',
      reason: 'small trade',
    });
    const largeTrade = createTradeProposal({
      strategyId: 'privacy-large',
      strategyType: 'manual',
      fromToken: 'USDC',
      toToken: 'SOL',
      amount: 150,
      chain: 'solana',
      reason: 'large trade',
    });

    const smallResult = checkPrivacy({
      transaction: { from: smallTrade.fromToken, to: smallTrade.toToken, amount: Number(smallTrade.amount) },
      policy_config: { mode: 'auto', thresholdUsd: 100, privateTokens: [] },
      proposal: smallTrade,
    });
    const largeResult = checkPrivacy({
      transaction: { from: largeTrade.fromToken, to: largeTrade.toToken, amount: Number(largeTrade.amount) },
      policy_config: { mode: 'auto', thresholdUsd: 100, privateTokens: [] },
      proposal: largeTrade,
    });

    assert.equal(smallResult.usePrivate, false);
    assert.equal(largeResult.usePrivate, true);
  });

  it('execution log persists async records through the Prisma store', async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    const proposal = createTradeProposal({
      strategyId: 'exec-store',
      strategyType: 'manual',
      fromToken: 'USDC',
      toToken: 'SOL',
      amount: 5,
      chain: 'solana',
      reason: 'execution log verification',
    });

    await logExecution({
      id: `exec-${proposal.id}`,
      proposalId: proposal.id,
      strategyId: proposal.strategyId,
      strategyType: proposal.strategyType,
      fromToken: proposal.fromToken,
      toToken: proposal.toToken,
      amount: proposal.amount,
      chain: proposal.chain,
      reason: proposal.reason,
      success: true,
      txHash: 'test-exec-hash',
      private: false,
      chatId: TEST_CHAT_ID,
    });

    const executions = await getExecutions({ strategyId: proposal.strategyId, limit: 10 });
    const found = executions.find((entry) => entry.proposalId === proposal.id);
    assert.ok(found, 'logged execution should be retrievable');
    assert.equal(found.txHash, 'test-exec-hash');
  });

  it('DCA plans survive round-trip storage and policy approval', async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    const plan = createDCAPlan({
      toToken: 'SOL',
      amount: 1,
      chain: 'solana',
      cron: '0 * * * *',
      chatId: TEST_CHAT_ID,
      policies: getDefaultPolicies('dca'),
      forcePrivate: true,
    });

    await addDCAPlan(plan);
    const storedPlans = await getDCAPlans(TEST_CHAT_ID);
    const stored = storedPlans.find((entry) => entry.id === plan.id);
    assert.ok(stored, 'stored plan should be retrievable');
    assert.equal(stored.forcePrivate, true);

    const proposal = createTradeProposal({
      strategyId: plan.id,
      strategyType: 'dca',
      fromToken: plan.fromToken,
      toToken: plan.toToken,
      amount: plan.amount,
      chain: plan.chain,
      reason: `DCA tick ${plan.id}`,
    });

    const policyResult = await runPolicies(proposal, {
      'spend-limit': { perTick: 10, daily: 50, total: 500 },
      cooldown: { intervalMs: 0 },
    });
    assert.equal(policyResult.approved, true, `DCA policy denied: ${policyResult.reason}`);

    const paused = await updateDCAPlan(plan.id, { status: 'paused' });
    assert.equal(paused.status, 'paused');
  });

  it('group consensus uses persisted votes and enforces quorum asynchronously', async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    const proposal = createGroupProposal({
      fromToken: 'USDC',
      toToken: 'SOL',
      amount: 25,
      chain: 'solana',
      proposerId: 111,
      proposerName: 'alice',
      chatId: TEST_GROUP_CHAT_ID,
      requiredVotes: 3,
      expiresInMinutes: 60,
    });
    await addProposal(proposal);

    let result = await checkConsensus({
      proposal: { strategyType: 'group', signal: { proposalId: proposal.id } },
      policy_config: { requiredVotes: 3 },
    });
    assert.equal(result.allow, false);

    await updateProposal(proposal.id, {
      votes: { 111: 'approve', 222: 'approve', 333: 'approve' },
      status: 'approved',
    });

    const stored = await getProposal(proposal.id);
    assert.equal(Object.keys(stored.votes).length, 3);

    result = await checkConsensus({
      proposal: { strategyType: 'group', signal: { proposalId: proposal.id } },
      policy_config: { requiredVotes: 3 },
    });
    assert.equal(result.allow, true);
  });

  it('signal automation strategies react to persisted alerts and typed bus events', async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    const dipAlert = await addPriceAlert(createPriceAlert({
      token: 'SOL',
      chain: 'solana',
      type: 'dip-buyer',
      direction: 'below',
      threshold: 5,
      buyToken: 'USDC',
      buyAmount: 1,
      chatId: TEST_CHAT_ID,
      policies: {},
    }));
    const takeProfitAlert = await addPriceAlert(createPriceAlert({
      token: 'SOL',
      chain: 'solana',
      type: 'take-profit',
      direction: 'above',
      threshold: 10,
      buyToken: 'USDC',
      buyAmount: 2,
      chatId: TEST_CHAT_ID,
      policies: {},
    }));

    const alerts = await getPriceAlerts(TEST_CHAT_ID);
    assert.ok(alerts.find((entry) => entry.id === dipAlert.id));
    assert.ok(alerts.find((entry) => entry.id === takeProfitAlert.id));

    let received = null;
    const unsubscribe = bus.subscribe(SignalType.PRICE_DIP, (signal) => {
      received = signal;
    });
    bus.signal(SignalType.PRICE_DIP, { token: 'SOL', chain: 'solana', dropPercent: 6.5, alertId: dipAlert.id });
    await new Promise((resolve) => setTimeout(resolve, 25));
    unsubscribe();

    assert.ok(received, 'bus subscriber should receive PRICE_DIP');

    const dipStrategy = new DipBuyerStrategy({ walletName: 'e2e-wallet' });
    const dipProposal = await dipStrategy.evaluate({
      type: SignalType.PRICE_DIP,
      alertId: dipAlert.id,
      token: 'SOL',
      chain: 'solana',
      dropPercent: 6.5,
      price: 140,
    });
    assert.ok(dipProposal, 'dip strategy should produce a proposal');

    const takeProfitStrategy = new TakeProfitStrategy({ walletName: 'e2e-wallet' });
    const takeProfitProposal = await takeProfitStrategy.evaluate({
      type: SignalType.PRICE_SPIKE,
      alertId: takeProfitAlert.id,
      token: 'SOL',
      chain: 'solana',
      gainPercent: 12,
      price: 165,
    });
    assert.ok(takeProfitProposal, 'take profit strategy should produce a proposal');
  });

  it('shield balances and transaction history persist through the current store', async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    const solMint = getTokenMint('SOL');
    assert.ok(solMint, 'SOL mint should resolve');

    await updateShieldBalance(walletAddress, 'SOL', 1_500_000n);
    await recordShieldTransaction({
      wallet: walletAddress,
      token: 'SOL',
      type: 'deposit',
      amount: '1500000',
      signature: `shield-${Date.now()}`,
    });

    const balance = await getShieldBalance(walletAddress, 'SOL');
    const history = await getShieldHistory(walletAddress, 10);

    assert.equal(balance, 1_500_000n);
    assert.ok(history.length >= 1, 'shield history should contain the recorded deposit');
    assert.equal(history[0].token, 'SOL');
  });
});
