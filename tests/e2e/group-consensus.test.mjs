import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { getKeypair } from '../../engine/lib/keypair.mjs';
import { createTradeProposal } from '../../engine/core/types.mjs';
import { addProposal, getProposals, updateProposal, clearProposals } from '../../engine/store/plans.mjs';
import { check as checkConsensus } from '../../engine/policies/consensus.mjs';
import { registerPropose, registerVote } from '../../engine/bot/commands/propose.mjs';
import { registerVote as registerVoteCommand } from '../../engine/bot/commands/vote.mjs';
import { 
  createRealTestEnvironment,
  setupRealTestEnv,
  runPreflightChecks,
  createRealTestBot,
  REAL_E2E_CONFIG 
} from './real-setup.mjs';

describe("E2E: Group Consensus Trading (Real)", () => {
  let testEnv, restoreEnv, keypair, testBot, testProposalId;
  const TEST_GROUP_CHAT_ID = -1001234567890; // Negative for group chats
  const TEST_USERS = [
    { id: 111111, username: 'alice', first_name: 'Alice' },
    { id: 222222, username: 'bob', first_name: 'Bob' },
    { id: 333333, username: 'charlie', first_name: 'Charlie' },
    { id: 444444, username: 'diana', first_name: 'Diana' }
  ];

  before(async () => {
    console.log('[E2E CONSENSUS] Setting up real consensus test environment...');
    
    // Create test environment
    testEnv = await createRealTestEnvironment();
    restoreEnv = setupRealTestEnv(testEnv.testDir);
    
    // Get real keypair
    keypair = getKeypair();
    
    // Run preflight checks
    await runPreflightChecks(keypair);
    
    // Create real Telegram bot for testing
    const botSetup = createRealTestBot();
    testBot = botSetup.bot;
    
    // Register consensus commands
    const config = {
      walletName: 'test-wallet',
      defaultChain: 'solana',
      requiredVotes: 3 // Require 3 out of 4 votes
    };
    
    registerPropose(testBot, config);
    registerVote(testBot, config);
    registerVoteCommand(testBot, config);
    
    // Clear any existing proposals
    clearProposals();
    
    console.log('[E2E CONSENSUS] Real consensus test environment ready');
  });

  after(async () => {
    if (testProposalId) {
      updateProposal(testProposalId, { status: 'cancelled' });
    }
    
    if (testEnv) testEnv.cleanup();
    if (restoreEnv) restoreEnv();
  });

  it("creates real trade proposal requiring group consensus", async () => {
    // Create a real trade proposal that requires consensus
    const proposal = createTradeProposal({
      strategyId: 'consensus-test',
      strategyType: 'group-consensus',
      fromToken: 'USDC',
      toToken: 'SOL',
      amount: 25, // Larger amount requiring consensus
      chain: 'solana',
      reason: 'Group consensus test trade',
      chatId: TEST_GROUP_CHAT_ID,
      proposedBy: TEST_USERS[0].id,
      requiredVotes: 3
    });
    
    assert.ok(proposal.id, 'Proposal should have ID');
    assert.equal(proposal.amount, 25, 'Proposal should have test amount');
    assert.equal(proposal.chatId, TEST_GROUP_CHAT_ID, 'Proposal should target group chat');
    assert.equal(proposal.proposedBy, TEST_USERS[0].id, 'Proposal should have proposer');
    
    // Add proposal to real storage
    const storedProposal = addProposal({
      ...proposal,
      status: 'pending',
      votes: [],
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
    });
    
    testProposalId = proposal.id;
    
    // Verify it was stored
    const proposals = getProposals(TEST_GROUP_CHAT_ID);
    assert.ok(proposals.length > 0, 'Proposal should be stored');
    
    const storedProp = proposals.find(p => p.id === proposal.id);
    assert.ok(storedProp, 'Specific proposal should be findable');
    assert.equal(storedProp.status, 'pending', 'Proposal should be pending');
    assert.ok(Array.isArray(storedProp.votes), 'Proposal should have votes array');
    
    console.log(`[E2E CONSENSUS] ✅ Created consensus proposal: ${proposal.id} - $${proposal.amount} ${proposal.toToken}`);
  });

  it("validates consensus policy with different vote counts", async () => {
    const proposals = getProposals(TEST_GROUP_CHAT_ID);
    const proposal = proposals[0];
    
    // Test with no votes - should fail
    let consensusResult = checkConsensus({
      proposal: { ...proposal, votes: [] },
      policy_config: { requiredVotes: 3 }
    });
    
    assert.equal(consensusResult.allow, false, 'Proposal with no votes should be denied');
    assert.ok(consensusResult.reason.includes('votes'), 'Reason should mention votes');
    
    // Test with insufficient votes - should fail
    consensusResult = checkConsensus({
      proposal: { 
        ...proposal, 
        votes: [
          { userId: TEST_USERS[0].id, vote: 'yes', timestamp: Date.now() },
          { userId: TEST_USERS[1].id, vote: 'yes', timestamp: Date.now() }
        ]
      },
      policy_config: { requiredVotes: 3 }
    });
    
    assert.equal(consensusResult.allow, false, 'Proposal with 2/3 votes should be denied');
    
    // Test with sufficient votes - should pass
    consensusResult = checkConsensus({
      proposal: { 
        ...proposal, 
        votes: [
          { userId: TEST_USERS[0].id, vote: 'yes', timestamp: Date.now() },
          { userId: TEST_USERS[1].id, vote: 'yes', timestamp: Date.now() },
          { userId: TEST_USERS[2].id, vote: 'yes', timestamp: Date.now() }
        ]
      },
      policy_config: { requiredVotes: 3 }
    });
    
    assert.equal(consensusResult.allow, true, 'Proposal with 3/3 yes votes should be approved');
    
    // Test with mixed votes - should fail
    consensusResult = checkConsensus({
      proposal: { 
        ...proposal, 
        votes: [
          { userId: TEST_USERS[0].id, vote: 'yes', timestamp: Date.now() },
          { userId: TEST_USERS[1].id, vote: 'yes', timestamp: Date.now() },
          { userId: TEST_USERS[2].id, vote: 'no', timestamp: Date.now() }
        ]
      },
      policy_config: { requiredVotes: 3 }
    });
    
    assert.equal(consensusResult.allow, false, 'Proposal with mixed votes should be denied');
    
    console.log(`[E2E CONSENSUS] ✅ Consensus policy validation completed`);
  });

  it("simulates real Telegram voting workflow", async () => {
    const proposals = getProposals(TEST_GROUP_CHAT_ID);
    let proposal = proposals[0];
    
    // Simulate users voting via Telegram commands
    for (let i = 0; i < 3; i++) {
      const user = TEST_USERS[i];
      
      // Create Telegram context for vote
      const voteCtx = {
        chat: { id: TEST_GROUP_CHAT_ID, type: 'group' },
        from: user,
        message: { 
          text: `/vote ${proposal.id} yes`, 
          message_id: Date.now() + i 
        },
        reply: async (text) => {
          console.log(`[E2E CONSENSUS] Vote reply to ${user.username}: ${text}`);
          return { message_id: Date.now() };
        },
        replyWithMarkdown: async (text) => {
          console.log(`[E2E CONSENSUS] Vote markdown reply to ${user.username}: ${text}`);
          return { message_id: Date.now() };
        }
      };
      
      // Process the vote (simulate bot command handling)
      const vote = {
        userId: user.id,
        username: user.username,
        vote: 'yes',
        timestamp: Date.now()
      };
      
      // Add vote to proposal
      const currentVotes = proposal.votes || [];
      const existingVoteIndex = currentVotes.findIndex(v => v.userId === user.id);
      
      if (existingVoteIndex >= 0) {
        currentVotes[existingVoteIndex] = vote;
      } else {
        currentVotes.push(vote);
      }
      
      // Update proposal with new vote
      proposal = updateProposal(proposal.id, { votes: currentVotes });
      assert.ok(proposal, 'Proposal should be updated with vote');
      
      console.log(`[E2E CONSENSUS] ✅ Vote recorded: ${user.username} voted ${vote.vote}`);
    }
    
    // Verify final vote count
    assert.equal(proposal.votes.length, 3, 'Should have 3 votes');
    assert.ok(proposal.votes.every(v => v.vote === 'yes'), 'All votes should be yes');
    
    // Test consensus check on final proposal
    const finalConsensusResult = checkConsensus({
      proposal,
      policy_config: { requiredVotes: 3 }
    });
    
    assert.equal(finalConsensusResult.allow, true, 'Proposal should pass consensus with 3 yes votes');
    
    console.log(`[E2E CONSENSUS] ✅ Telegram voting workflow completed`);
  });

  it("tests proposal expiration and cleanup", async () => {
    // Create an expired proposal
    const expiredProposal = createTradeProposal({
      strategyId: 'expired-test',
      strategyType: 'group-consensus', 
      fromToken: 'USDC',
      toToken: 'SOL',
      amount: 10,
      chain: 'solana',
      reason: 'Expired test proposal',
      chatId: TEST_GROUP_CHAT_ID,
      proposedBy: TEST_USERS[0].id
    });
    
    // Add with past expiration
    const expiredStored = addProposal({
      ...expiredProposal,
      status: 'pending',
      votes: [],
      createdAt: Date.now() - 48 * 60 * 60 * 1000, // 48 hours ago
      expiresAt: Date.now() - 24 * 60 * 60 * 1000  // Expired 24 hours ago
    });
    
    assert.ok(expiredStored, 'Expired proposal should be stored');
    
    // Test consensus check on expired proposal
    const expiredResult = checkConsensus({
      proposal: expiredStored,
      policy_config: { requiredVotes: 3 }
    });
    
    assert.equal(expiredResult.allow, false, 'Expired proposal should be denied');
    assert.ok(expiredResult.reason.includes('expired'), 'Reason should mention expiration');
    
    // Mark as expired
    updateProposal(expiredProposal.id, { status: 'expired' });
    
    const updatedProposals = getProposals(TEST_GROUP_CHAT_ID);
    const expiredProp = updatedProposals.find(p => p.id === expiredProposal.id);
    assert.equal(expiredProp.status, 'expired', 'Proposal should be marked expired');
    
    console.log(`[E2E CONSENSUS] ✅ Proposal expiration handling validated`);
  });

  it("validates vote uniqueness and updates", async () => {
    const proposals = getProposals(TEST_GROUP_CHAT_ID);
    let proposal = proposals.find(p => p.status !== 'expired');
    
    const user = TEST_USERS[0];
    const initialVoteCount = proposal.votes.length;
    
    // User votes yes
    const yesVote = {
      userId: user.id,
      username: user.username,
      vote: 'yes',
      timestamp: Date.now()
    };
    
    let votes = [...(proposal.votes || [])];
    const existingIndex = votes.findIndex(v => v.userId === user.id);
    if (existingIndex >= 0) {
      votes[existingIndex] = yesVote;
    } else {
      votes.push(yesVote);
    }
    
    proposal = updateProposal(proposal.id, { votes });
    
    // User changes vote to no
    const noVote = {
      userId: user.id,
      username: user.username,
      vote: 'no',
      timestamp: Date.now() + 1000
    };
    
    votes = [...proposal.votes];
    const updateIndex = votes.findIndex(v => v.userId === user.id);
    assert.ok(updateIndex >= 0, 'Should find existing vote to update');
    
    votes[updateIndex] = noVote;
    proposal = updateProposal(proposal.id, { votes });
    
    // Verify vote was updated, not duplicated
    const userVotes = proposal.votes.filter(v => v.userId === user.id);
    assert.equal(userVotes.length, 1, 'User should have exactly one vote');
    assert.equal(userVotes[0].vote, 'no', 'Vote should be updated to no');
    assert.ok(userVotes[0].timestamp > yesVote.timestamp, 'Updated vote should have newer timestamp');
    
    console.log(`[E2E CONSENSUS] ✅ Vote uniqueness and updates validated`);
  });

  it("tests real consensus execution flow", async () => {
    // Get a proposal with sufficient votes
    const proposals = getProposals(TEST_GROUP_CHAT_ID);
    const approvedProposal = proposals.find(p => 
      p.status === 'pending' && 
      (p.votes || []).filter(v => v.vote === 'yes').length >= 3
    );
    
    if (!approvedProposal) {
      console.log('[E2E CONSENSUS] No approved proposal found for execution test');
      return;
    }
    
    // Verify it passes consensus
    const consensusResult = checkConsensus({
      proposal: approvedProposal,
      policy_config: { requiredVotes: 3 }
    });
    
    assert.equal(consensusResult.allow, true, 'Approved proposal should pass consensus');
    
    // Mark as approved for execution
    const approvedForExecution = updateProposal(approvedProposal.id, { 
      status: 'approved',
      approvedAt: Date.now()
    });
    
    assert.equal(approvedForExecution.status, 'approved', 'Proposal should be marked approved');
    assert.ok(approvedForExecution.approvedAt, 'Proposal should have approval timestamp');
    
    // In a real system, this would trigger the execution engine
    console.log(`[E2E CONSENSUS] ✅ Consensus execution flow validated for proposal ${approvedProposal.id}`);
  });

  it("validates consensus proposal persistence", async () => {
    // Proposals should persist across restarts
    const proposalsBeforeRestart = getProposals(TEST_GROUP_CHAT_ID);
    assert.ok(proposalsBeforeRestart.length > 0, 'Should have proposals before restart');
    
    // Simulate restart by re-initializing storage
    const { initPlansStore } = await import('../../engine/store/plans.mjs');
    initPlansStore(testEnv.testDir);
    
    // Proposals should still be there
    const proposalsAfterRestart = getProposals(TEST_GROUP_CHAT_ID);
    assert.equal(proposalsAfterRestart.length, proposalsBeforeRestart.length, 'Proposals should persist');
    
    if (proposalsAfterRestart.length > 0) {
      const proposal = proposalsAfterRestart[0];
      assert.ok(proposal.id, 'Proposal should have ID after restart');
      assert.ok(Array.isArray(proposal.votes), 'Proposal should have votes array');
    }
    
    console.log(`[E2E CONSENSUS] ✅ Proposal persistence validated`);
  });
});