import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { getKeypair } from '../../engine/lib/keypair.mjs';
import { createDCAPlan, createTradeProposal } from '../../engine/core/types.mjs';
import {
  addDCAPlan,
  getDCAPlans,
  updateDCAPlan,
  clearDCAPlans,
  initPlansStore,
} from '../../engine/store/plans.mjs';
import { getDefaultPolicies, runPolicies } from '../../engine/policies/engine.mjs';
import { syncJobs, getSchedulerStatus, stopScheduler } from '../../engine/monitors/scheduler.mjs';
import {
  createRealTestEnvironment,
  setupRealTestEnv,
  runPreflightChecks,
  REAL_E2E_CONFIG,
} from './real-setup.mjs';

describe("E2E: DCA Strategy (Real)", () => {
  let testEnv, restoreEnv, keypair, suiteSkipReason = null;
  let testPlanId = null;
  const TEST_CHAT_ID = 123456789;

  before(async () => {
    console.log('[E2E DCA] Setting up real DCA test environment...');

    try {
      testEnv = await createRealTestEnvironment();
      restoreEnv = setupRealTestEnv(testEnv.testDir);
      await initPlansStore(testEnv.testDir);
      keypair = getKeypair();
      await runPreflightChecks(keypair);
      await clearDCAPlans();
      console.log('[E2E DCA] Real DCA test environment ready');
    } catch (err) {
      if (testEnv) testEnv.cleanup();
      if (restoreEnv) restoreEnv();
      suiteSkipReason = `real E2E preflight failed: ${err.message.split('\n')[0]}`;
    }
  });

  after(async () => {
    stopScheduler();
    if (testPlanId) {
      await updateDCAPlan(testPlanId, { status: 'cancelled' });
    }
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

  it("creates and persists a DCA plan", async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    const plan = createDCAPlan({
      toToken: 'SOL',
      amount: REAL_E2E_CONFIG.TEST_DCA_AMOUNT,
      chain: 'solana',
      cron: '*/30 * * * * *',
      chatId: TEST_CHAT_ID,
      policies: getDefaultPolicies('dca'),
      forcePrivate: false,
    });

    await addDCAPlan(plan);
    testPlanId = plan.id;

    const storedPlans = await getDCAPlans(TEST_CHAT_ID);
    const stored = storedPlans.find((p) => p.id === plan.id);

    assert.ok(stored, 'plan should be stored');
    assert.equal(stored.toToken, 'SOL');
    assert.equal(Number(stored.amount), REAL_E2E_CONFIG.TEST_DCA_AMOUNT);
    assert.equal(stored.status, 'active');
  });

  it("approves a small DCA proposal through the policy engine", async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    const plan = createDCAPlan({
      toToken: 'SOL',
      amount: 1,
      chain: 'solana',
      cron: '0 * * * *',
      chatId: TEST_CHAT_ID,
      policies: getDefaultPolicies('dca'),
    });
    await addDCAPlan(plan);

    const proposal = createTradeProposal({
      strategyId: plan.id,
      strategyType: 'dca',
      fromToken: 'USDC',
      toToken: 'SOL',
      amount: plan.amount,
      chain: plan.chain,
      reason: `DCA tick: ${plan.id}`,
    });

    const result = await runPolicies(proposal, {
      'spend-limit': { perTick: 10, daily: 50, total: 1000 },
      'cooldown': { intervalMs: 0 },
    });

    assert.equal(result.approved, true, `DCA proposal denied: ${result.reason}`);
  });

  it("syncs active DCA plans into the scheduler", async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    const plan = createDCAPlan({
      toToken: 'SOL',
      amount: 1,
      chain: 'solana',
      cron: '*/30 * * * * *',
      chatId: TEST_CHAT_ID,
      policies: getDefaultPolicies('dca'),
    });
    await addDCAPlan(plan);

    await syncJobs();
    const status = getSchedulerStatus();
    assert.ok(status.activeJobs >= 1, 'scheduler should track at least one active job');
    assert.ok(status.jobs.includes(plan.id), 'scheduler should include the created plan');
  });

  it("supports pause, resume, cancel lifecycle updates", async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    const plan = createDCAPlan({
      toToken: 'SOL',
      amount: 1,
      chain: 'solana',
      cron: '0 * * * *',
      chatId: TEST_CHAT_ID,
      policies: {},
    });
    await addDCAPlan(plan);

    const paused = await updateDCAPlan(plan.id, { status: 'paused' });
    assert.equal(paused.status, 'paused');

    const resumed = await updateDCAPlan(plan.id, { status: 'active' });
    assert.equal(resumed.status, 'active');

    const cancelled = await updateDCAPlan(plan.id, { status: 'cancelled' });
    assert.equal(cancelled.status, 'cancelled');
  });

  it("persists DCA plans across store reinitialization", async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    const plan = createDCAPlan({
      toToken: 'SOL',
      amount: 1,
      chain: 'solana',
      cron: '0 * * * *',
      chatId: TEST_CHAT_ID,
      policies: {},
      forcePrivate: true,
    });
    await addDCAPlan(plan);

    const before = await getDCAPlans(TEST_CHAT_ID);
    assert.ok(before.some((p) => p.id === plan.id));

    await initPlansStore(testEnv.testDir);

    const after = await getDCAPlans(TEST_CHAT_ID);
    const stored = after.find((p) => p.id === plan.id);
    assert.ok(stored, 'plan should survive reinitialization');
    assert.equal(stored.forcePrivate, true);
  });
});
