import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { getKeypair } from '../../engine/lib/keypair.mjs';
import bus from '../../engine/core/event-bus.mjs';
import { SignalType } from '../../engine/core/types.mjs';
import { DipBuyerStrategy } from '../../engine/strategies/dip-buyer.mjs';
import { TakeProfitStrategy } from '../../engine/strategies/take-profit.mjs';
import { RebalancerStrategy } from '../../engine/strategies/rebalancer.mjs';
import {
  addAlert,
  getAlerts,
  clearAlerts,
  initPlansStore,
} from '../../engine/store/plans.mjs';
import {
  createRealTestEnvironment,
  setupRealTestEnv,
  runPreflightChecks,
  REAL_E2E_CONFIG,
} from './real-setup.mjs';

describe("E2E: Signal-Reactive Automation (Real)", () => {
  let testEnv, restoreEnv, keypair, suiteSkipReason = null;
  const TEST_CHAT_ID = 123456789;

  before(async () => {
    console.log('[E2E SIGNALS] Setting up real signal automation test environment...');

    try {
      testEnv = await createRealTestEnvironment();
      restoreEnv = setupRealTestEnv(testEnv.testDir);
      await initPlansStore(testEnv.testDir);
      keypair = getKeypair();
      await runPreflightChecks(keypair);
      await clearAlerts();
      bus.resetStats();
      console.log('[E2E SIGNALS] Real signal automation test environment ready');
    } catch (err) {
      if (testEnv) testEnv.cleanup();
      if (restoreEnv) restoreEnv();
      suiteSkipReason = `real E2E preflight failed: ${err.message.split('\n')[0]}`;
    }
  });

  after(async () => {
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

  it("records and retrieves alerts with real store persistence", async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    const initial = await getAlerts(TEST_CHAT_ID);

    const dipAlert = await addAlert({
      id: `dip-${Date.now()}`,
      type: 'price_dip',
      token: 'SOL',
      threshold: 5,
      amount: REAL_E2E_CONFIG.TEST_TRADE_AMOUNT,
      chain: 'solana',
      chatId: TEST_CHAT_ID,
      status: 'active',
      createdAt: Date.now(),
    });

    const takeProfitAlert = await addAlert({
      id: `tp-${Date.now()}`,
      type: 'take_profit',
      token: 'SOL',
      threshold: 10,
      amount: REAL_E2E_CONFIG.TEST_TRADE_AMOUNT,
      chain: 'solana',
      chatId: TEST_CHAT_ID,
      status: 'active',
      createdAt: Date.now(),
    });

    const stored = await getAlerts(TEST_CHAT_ID);
    assert.equal(stored.length, initial.length + 2);
    assert.ok(stored.find((a) => a.id === dipAlert.id));
    assert.ok(stored.find((a) => a.id === takeProfitAlert.id));
  });

  it("event bus emits and subscribers receive typed signals", async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    let received = null;
    const unsubscribe = bus.subscribe(SignalType.PRICE_DIP, (signal) => {
      received = signal;
    });

    bus.signal(SignalType.PRICE_DIP, {
      token: 'SOL',
      chain: 'solana',
      dropPercent: 5.5,
      alertId: 'bus-test',
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    unsubscribe();

    assert.ok(received, 'subscriber should receive the signal');
    assert.equal(received.token, 'SOL');
    assert.equal(bus.getStats()[SignalType.PRICE_DIP] >= 1, true);
  });

  it("DipBuyerStrategy.evaluate returns a proposal for a matching alert", async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    const alert = await addAlert({
      id: `dip-match-${Date.now()}`,
      type: 'price_dip',
      token: 'SOL',
      threshold: 5,
      amount: REAL_E2E_CONFIG.TEST_TRADE_AMOUNT,
      chain: 'solana',
      chatId: TEST_CHAT_ID,
      status: 'active',
      createdAt: Date.now(),
    });

    const strategy = new DipBuyerStrategy({ walletName: 'test-wallet' });
    const proposal = await strategy.evaluate({
      type: SignalType.PRICE_DIP,
      alertId: alert.id,
      token: 'SOL',
      chain: 'solana',
      dropPercent: 6.5,
      price: 140,
    });

    assert.ok(proposal, 'dip buyer should produce a proposal');
    assert.equal(proposal.fromToken, 'USDC');
    assert.equal(proposal.toToken, 'SOL');
  });

  it("TakeProfitStrategy.evaluate returns a proposal for a matching alert", async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    const alert = await addAlert({
      id: `tp-match-${Date.now()}`,
      type: 'take_profit',
      token: 'SOL',
      threshold: 10,
      amount: 2,
      chain: 'solana',
      chatId: TEST_CHAT_ID,
      status: 'active',
      createdAt: Date.now(),
    });

    const strategy = new TakeProfitStrategy({ walletName: 'test-wallet' });
    const proposal = await strategy.evaluate({
      type: SignalType.PRICE_SPIKE,
      alertId: alert.id,
      token: 'SOL',
      chain: 'solana',
      gainPercent: 12,
      price: 165,
    });

    assert.ok(proposal, 'take profit should produce a proposal');
    assert.equal(proposal.fromToken, 'SOL');
    assert.equal(proposal.toToken, 'USDC');
  });

  it("RebalancerStrategy.evaluate proposes a trade for meaningful drift", async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    const strategy = new RebalancerStrategy({ walletName: 'test-wallet' });
    const proposal = await strategy.evaluate({
      targetId: 'rebal-test',
      chain: 'solana',
      policies: {},
      drifts: [
        { token: 'SOL', actual: 60, delta: 15, currentValue: 1500 },
        { token: 'USDC', actual: 20, delta: -10, currentValue: 500 },
      ],
    });

    assert.ok(proposal, 'rebalancer should produce a proposal');
    assert.equal(proposal.fromToken, 'SOL');
    assert.equal(proposal.toToken, 'USDC');
  });
});
