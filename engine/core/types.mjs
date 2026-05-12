/**
 * AEGIS type definitions — signal types, trade proposals, execution results.
 * Pure data constructors, no classes. Everything is a plain object.
 */

// ─── Signal Types ────────────────────────────────────────────────────────────

export const SignalType = Object.freeze({
  // Price signals
  PRICE_DIP: 'PRICE_DIP',
  PRICE_SPIKE: 'PRICE_SPIKE',
  THRESHOLD_HIT: 'THRESHOLD_HIT',

  // Portfolio signals
  DRIFT_DETECTED: 'DRIFT_DETECTED',
  ALLOCATION_SHIFT: 'ALLOCATION_SHIFT',

  // Schedule signals
  DCA_TICK: 'DCA_TICK',

  // Whale signals
  WHALE_BUY: 'WHALE_BUY',
  WHALE_SELL: 'WHALE_SELL',

  // Group signals
  PROPOSAL: 'PROPOSAL',
  VOTE_CAST: 'VOTE_CAST',
  CONSENSUS: 'CONSENSUS',
});

// ─── Signal Constructors ─────────────────────────────────────────────────────

export function createSignal(type, data) {
  return {
    type,
    timestamp: new Date().toISOString(),
    ...data,
  };
}

// ─── Trade Proposal ──────────────────────────────────────────────────────────

let _proposalCounter = 0;

export function createTradeProposal({
  strategyId,
  strategyType,
  fromToken,
  toToken,
  amount,
  chain,
  reason,
  signal,
  policies = {},
  forcePrivate = false,
}) {
  return {
    id: `trade-${Date.now()}-${++_proposalCounter}`,
    strategyId,
    strategyType,
    fromToken,
    toToken,
    amount: String(amount),
    chain,
    reason,
    signal,
    policies,
    forcePrivate, // If true, use MagicBlock private execution
    timestamp: new Date().toISOString(),
    status: 'pending', // pending → approved → executing → completed | failed | denied
  };
}

// ─── Execution Result ────────────────────────────────────────────────────────

export function createExecutionResult(
  proposal,
  { success, txHash, error, errorCode, quote, private: isPrivate, shieldedBalance, advisoryHalt = false }
) {
  return {
    id: `exec-${Date.now()}`,
    proposalId: proposal.id,
    strategyId: proposal.strategyId,
    strategyType: proposal.strategyType,
    fromToken: proposal.fromToken,
    toToken: proposal.toToken,
    amount: proposal.amount,
    chain: proposal.chain,
    reason: proposal.reason,
    success,
    txHash: txHash || null,
    error: error || null,
    errorCode: errorCode || null,
    estimatedOutput: quote?.estimatedOutput || null,
    liquiditySource: quote?.liquiditySource || null,
    private: isPrivate || false, // True if executed via MagicBlock
    shieldedBalance: shieldedBalance || null, // Remaining shielded balance after private execution
    advisoryHalt,
    chatId: proposal?.signal?.chatId ?? proposal?.chatId ?? null,
    missionId: proposal?.missionId ?? null,
    timestamp: new Date().toISOString(),
  };
}

// ─── Strategy Types ──────────────────────────────────────────────────────────

export const StrategyType = Object.freeze({
  DCA: 'dca',
  DIP_BUYER: 'dip-buyer',
  TAKE_PROFIT: 'take-profit',
  REBALANCER: 'rebalancer',
  GROUP_CONSENSUS: 'group',
});

// ─── Policy Result ───────────────────────────────────────────────────────────

export function createPolicyResult(allow, reason = '') {
  return { allow, reason };
}

// ─── DCA Plan ────────────────────────────────────────────────────────────────

let _planCounter = 0;

export function createDCAPlan({
  fromToken = 'USDC',
  toToken,
  amount,
  chain,
  cron,
  policies = {},
  chatId,
  forcePrivate = false,
}) {
  return {
    id: `dca-${Date.now()}-${++_planCounter}`,
    type: 'dca',
    fromToken,
    toToken,
    amount: String(amount),
    chain,
    cron, // cron expression like '*/5 * * * *'
    policies,
    chatId,
    forcePrivate, // If true, use MagicBlock private execution for all ticks
    status: 'active', // active | paused | cancelled
    totalExecuted: 0,
    totalSpent: 0,
    createdAt: new Date().toISOString(),
  };
}

// ─── Rebalance Target ────────────────────────────────────────────────────────

export function createRebalanceTarget({ chatId, chain, targets, threshold = 5, policies = {} }) {
  return {
    id: `rebal-${Date.now()}`,
    type: 'rebalance',
    chain,
    targets, // [{ token: 'SOL', weight: 50 }, { token: 'ETH', weight: 30 }, ...]
    threshold, // % drift before rebalancing
    policies,
    chatId,
    status: 'active',
    createdAt: new Date().toISOString(),
  };
}

// ─── Price Alert ─────────────────────────────────────────────────────────────

export function createPriceAlert({
  token,
  chain,
  type, // 'dip-buyer' | 'take-profit' | 'alert-only'
  direction, // 'below' | 'above'
  threshold, // percentage drop/gain
  buyToken,
  buyAmount,
  chatId,
  policies = {},
}) {
  return {
    id: `alert-${Date.now()}`,
    token,
    chain,
    type,
    direction,
    threshold: Number(threshold),
    buyToken: buyToken || null,
    buyAmount: buyAmount ? String(buyAmount) : null,
    policies,
    chatId,
    status: 'active',
    referencePrice: null, // set when monitor starts tracking
    createdAt: new Date().toISOString(),
  };
}

// ─── Group Proposal ──────────────────────────────────────────────────────────

export function createGroupProposal({
  fromToken,
  toToken,
  amount,
  chain,
  proposerId,
  proposerName,
  chatId,
  requiredVotes = 3,
  expiresInMinutes = 15,
}) {
  const now = new Date();
  return {
    id: `prop-${Date.now()}`,
    fromToken,
    toToken,
    amount: String(amount),
    chain,
    proposerId,
    proposerName,
    chatId,
    requiredVotes,
    votes: {}, // { odId: 'approve' | 'reject' }
    expiresAt: new Date(now.getTime() + expiresInMinutes * 60_000).toISOString(),
    status: 'voting', // voting → approved → executed | rejected | expired
    createdAt: now.toISOString(),
  };
}
