import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { getKeypair } from '../../engine/lib/keypair.mjs';
import { createGroupProposal } from '../../engine/core/types.mjs';
import {
  addProposal,
  getProposal,
  getProposals,
  updateProposal,
  clearProposals,
  initPlansStore,
} from '../../engine/store/plans.mjs';
import { check as checkConsensus } from '../../engine/policies/consensus.mjs';
import {
  createRealTestEnvironment,
  setupRealTestEnv,
  runPreflightChecks,
} from './real-setup.mjs';

describe("E2E: Group Consensus Trading (Real)", () => {
  let testEnv, restoreEnv, keypair, suiteSkipReason = null;
  let testProposalId = null;
  const TEST_GROUP_CHAT_ID = -1001234567890;

  before(async () => {
    console.log('[E2E CONSENSUS] Setting up real consensus test environment...');

    try {
      testEnv = await createRealTestEnvironment();
      restoreEnv = setupRealTestEnv(testEnv.testDir);
      await initPlansStore(testEnv.testDir);
      keypair = getKeypair();
      await runPreflightChecks(keypair);
      await clearProposals();
      console.log('[E2E CONSENSUS] Real consensus test environment ready');
    } catch (err) {
      if (testEnv) testEnv.cleanup();
      if (restoreEnv) restoreEnv();
      suiteSkipReason = `real E2E preflight failed: ${err.message.split('\n')[0]}`;
    }
  });

  after(async () => {
    if (testProposalId) {
      await updateProposal(testProposalId, { status: 'cancelled' });
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

  async function createStoredProposal(overrides = {}) {
    const proposal = createGroupProposal({
      fromToken: 'USDC',
      toToken: 'SOL',
      amount: 25,
      chain: 'solana',
      proposerId: 111111,
      proposerName: 'Alice',
      chatId: TEST_GROUP_CHAT_ID,
      requiredVotes: 3,
      expiresInMinutes: 60,
      ...overrides,
    });
    await addProposal(proposal);
    testProposalId = proposal.id;
    return proposal;
  }

  it("creates and persists a group proposal", async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    const proposal = await createStoredProposal();
    const proposals = await getProposals(TEST_GROUP_CHAT_ID);
    const stored = proposals.find((p) => p.id === proposal.id);

    assert.ok(stored, 'proposal should be stored');
    assert.equal(stored.chatId, String(TEST_GROUP_CHAT_ID));
    assert.equal(stored.status, 'voting');
    assert.deepEqual(stored.votes, {});
  });

  it("denies consensus until approvals reach the threshold", async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    const proposal = await createStoredProposal();
    let result = await checkConsensus({
      proposal: { strategyType: 'group', signal: { proposalId: proposal.id } },
      policy_config: { requiredVotes: 3 },
    });
    assert.equal(result.allow, false);

    await updateProposal(proposal.id, { votes: { 111111: 'approve', 222222: 'approve' } });
    result = await checkConsensus({
      proposal: { strategyType: 'group', signal: { proposalId: proposal.id } },
      policy_config: { requiredVotes: 3 },
    });
    assert.equal(result.allow, false);
    assert.match(result.reason, /Need 3 approvals/i);
  });

  it("allows consensus at 3 approvals and updates votes in-place", async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    const proposal = await createStoredProposal();
    await updateProposal(proposal.id, {
      votes: { 111111: 'approve', 222222: 'approve', 333333: 'approve' },
    });

    let stored = await getProposal(proposal.id);
    assert.equal(Object.keys(stored.votes).length, 3);

    let result = await checkConsensus({
      proposal: { strategyType: 'group', signal: { proposalId: proposal.id } },
      policy_config: { requiredVotes: 3 },
    });
    assert.equal(result.allow, true);

    await updateProposal(proposal.id, {
      votes: { ...stored.votes, 333333: 'reject' },
    });
    stored = await getProposal(proposal.id);
    assert.equal(Object.keys(stored.votes).length, 3);
    assert.equal(stored.votes['333333'], 'reject');

    result = await checkConsensus({
      proposal: { strategyType: 'group', signal: { proposalId: proposal.id } },
      policy_config: { requiredVotes: 3 },
    });
    assert.equal(result.allow, false);
  });

  it("denies expired proposals", async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    const proposal = await createStoredProposal();
    await updateProposal(proposal.id, {
      votes: { 111111: 'approve', 222222: 'approve', 333333: 'approve' },
      status: 'voting',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const result = await checkConsensus({
      proposal: { strategyType: 'group', signal: { proposalId: proposal.id } },
      policy_config: { requiredVotes: 3 },
    });
    assert.equal(result.allow, false);
  });

  it("persists proposals across store reinitialization", async (t) => {
    if (skipIfSuiteBlocked(t)) return;

    const proposal = await createStoredProposal();
    const before = await getProposals(TEST_GROUP_CHAT_ID);
    assert.ok(before.some((p) => p.id === proposal.id));

    await initPlansStore(testEnv.testDir);

    const after = await getProposals(TEST_GROUP_CHAT_ID);
    assert.ok(after.some((p) => p.id === proposal.id));
  });
});
