/**
 * Tool registry — the surface the LLM agent can call.
 *
 * Naming maps to user-facing verbs (getPortfolio, executeSwap, ...). Each
 * tool wraps existing engine/CLI functions; no logic is duplicated.
 *
 * Mutation safety:
 *   - Read tools: no `needsApproval`.
 *   - Write tools: `needsApproval: true` so the operator-facing surface
 *     must confirm with a human before the SDK calls execute().
 *   - Even with approval, write tools that move funds (executeSwap) run
 *     through `runPolicies()` inside execute(); the policy gate is
 *     authoritative regardless of what the surface does.
 */

import {
  getPortfolio,
  getPositions,
  getPnl,
  getHistory,
} from './portfolio.mjs';
import {
  getTokenPrice,
  searchToken,
  listChains,
} from './market.mjs';
import {
  getSwapQuote,
  executeSwap,
} from './swap.mjs';
import {
  createDCAPlan,
  listDCAPlans,
  pauseDCAPlan,
  cancelDCAPlan,
} from './dca.mjs';
import {
  listAvailablePoliciesTool,
  showActivePolicies,
  getDefaultPoliciesForStrategy,
} from './policy.mjs';
import {
  getShieldBalance,
  depositToShield,
  withdrawFromShield,
} from './shield.mjs';
import {
  listWalletsTool,
  getWalletAddresses,
} from './wallet.mjs';
import {
  rememberFact,
  recallFacts,
  forgetFact,
  listFacts,
} from './facts.mjs';
import {
  searchFacts,
  searchTradeHistory,
  summarizeSimilarTrades,
} from './memory-search.mjs';
import {
  commitMission,
  listMissions,
  getMissionStatus,
  pauseMission,
  resumeMission,
  cancelMission,
} from './missions.mjs';

export const allTools = {
  // Portfolio
  getPortfolio,
  getPositions,
  getPnl,
  getHistory,
  // Market
  getTokenPrice,
  searchToken,
  listChains,
  // Swap
  getSwapQuote,
  executeSwap,
  // DCA
  createDCAPlan,
  listDCAPlans,
  pauseDCAPlan,
  cancelDCAPlan,
  // Policy
  listAvailablePolicies: listAvailablePoliciesTool,
  showActivePolicies,
  getDefaultPoliciesForStrategy,
  // Shield (MagicBlock)
  getShieldBalance,
  depositToShield,
  withdrawFromShield,
  // Wallet (read-only)
  listWallets: listWalletsTool,
  getWalletAddresses,
  // Semantic facts (agent scratch space)
  rememberFact,
  recallFacts,
  forgetFact,
  listFacts,
  // QVAC RAG — local-first semantic memory
  searchFacts,
  searchTradeHistory,
  summarizeSimilarTrades,
  // Missions — autonomous-envelope primitive
  commitMission,
  listMissions,
  getMissionStatus,
  pauseMission,
  resumeMission,
  cancelMission,
};

export const scheduledTools = {
  // Portfolio + market reads
  getPortfolio,
  getPositions,
  getPnl,
  getHistory,
  getTokenPrice,
  searchToken,
  listChains,
  // Policy visibility
  listAvailablePolicies: listAvailablePoliciesTool,
  showActivePolicies,
  getDefaultPoliciesForStrategy,
  // Wallet/shield reads
  getShieldBalance,
  listWallets: listWalletsTool,
  getWalletAddresses,
  // Memory reads + safe writes
  rememberFact,
  recallFacts,
  listFacts,
  searchFacts,
  searchTradeHistory,
  summarizeSimilarTrades,
  // Mission visibility
  listMissions,
  getMissionStatus,
};

export const systemFollowupTools = {
  getPortfolio,
  getPositions,
  getPnl,
  getTokenPrice,
  searchToken,
  listChains,
  recallFacts,
  listFacts,
  searchFacts,
  searchTradeHistory,
  summarizeSimilarTrades,
  listMissions,
  getMissionStatus,
};

export function getToolRegistry(turnProfile = 'interactive') {
  if (turnProfile === 'scheduled') return scheduledTools;
  if (turnProfile === 'system_followup') return systemFollowupTools;
  return allTools;
}
