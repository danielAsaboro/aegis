import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { getKeypair } from '../../engine/lib/keypair.mjs';
import { initDb, closeDb } from '../../engine/db/index.mjs';
import { createMessageRuntime } from '../../engine/runtime/message-runtime.mjs';
import { createScheduledJob } from '../../engine/runtime/scheduled-jobs.mjs';
import { syncJobs, stopScheduler } from '../../engine/monitors/scheduler.mjs';
import { getHistory, clearHistory } from '../../engine/agent/db-memory.mjs';
import {
  createRealTestEnvironment,
  setupRealTestEnv,
  runPreflightChecks,
} from './real-setup.mjs';

describe("E2E: Scheduled Agent Turn (Real)", () => {
  let testEnv, restoreEnv, keypair, suiteSkipReason = null;
  const delivered = [];
  const TEST_CHAT_ID = '987654321';
  const TEST_USER_ID = 'scheduled-e2e-user';
  let messageRuntime = null;

  before(async () => {
    console.log('[E2E SCHEDULED] Setting up scheduled agent-turn environment...');

    try {
      testEnv = await createRealTestEnvironment();
      restoreEnv = setupRealTestEnv(testEnv.testDir);
      await initDb();
      keypair = getKeypair();
      await runPreflightChecks(keypair);
      await clearHistory(TEST_USER_ID);
      messageRuntime = createMessageRuntime({
        walletName: process.env.DEFAULT_WALLET || 'default',
        deliveryHandlers: {
          telegram: async ({ type, text, envelope }) => {
            delivered.push({
              type,
              text,
              chatId: envelope?.delivery?.chatId || null,
              at: Date.now(),
            });
          },
          default: async ({ type, text }) => {
            delivered.push({ type, text, chatId: null, at: Date.now() });
          },
        },
        approvalHandlers: {
          telegram: async ({ approvals }) => approvals.map(() => false),
          default: async ({ approvals }) => approvals.map(() => false),
        },
      });
      console.log('[E2E SCHEDULED] Real scheduled-turn environment ready');
    } catch (err) {
      if (messageRuntime) messageRuntime.stop();
      await closeDb().catch(() => {});
      if (testEnv) testEnv.cleanup();
      if (restoreEnv) restoreEnv();
      suiteSkipReason = `real scheduled E2E preflight failed: ${err.message.split('\n')[0]}`;
    }
  });

  after(async () => {
    stopScheduler();
    if (messageRuntime) messageRuntime.stop();
    await closeDb().catch(() => {});
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

  async function waitFor(predicate, timeoutMs = 45000, intervalMs = 250) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`Condition not met within ${timeoutMs}ms`);
  }

  it("fires a persisted scheduled agent turn, delivers a message, and saves shared history", async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    delivered.length = 0;
    await clearHistory(TEST_USER_ID);

    const fireAt = new Date(Date.now() + 1500).toISOString();
    const marker = `SCHEDULED_E2E_OK_${Date.now()}`;

    await createScheduledJob({
      kind: 'agent_turn',
      scheduleKind: 'at',
      scheduleValue: fireAt,
      userId: TEST_USER_ID,
      chatId: TEST_CHAT_ID,
      prompt: `Scheduled self-test. Reply with exactly ${marker} and nothing else.`,
      title: 'Scheduled E2E self-test',
    });

    await syncJobs({ messageRuntime });

    await waitFor(() => delivered.some((entry) => entry.type === 'response' && typeof entry.text === 'string' && entry.text.includes(marker)));

    const response = delivered.find((entry) => entry.type === 'response' && entry.text.includes(marker));
    assert.ok(response, 'scheduled job should deliver a response');
    assert.equal(response.chatId, TEST_CHAT_ID);

    const history = await getHistory(TEST_USER_ID);
    const scheduledUserTurn = history.find((entry) => entry.role === 'user' && entry.source === 'scheduled' && typeof entry.content === 'string' && entry.content.includes(marker));
    const scheduledAssistantTurn = history.find((entry) => entry.role === 'assistant' && entry.source === 'scheduled');

    assert.ok(scheduledUserTurn, 'scheduled prompt should be persisted in shared history');
    assert.match(scheduledUserTurn.content, /^\[Scheduled task\]/);
    assert.ok(scheduledAssistantTurn, 'scheduled response should be persisted in shared history');
  }, 60000);
});
