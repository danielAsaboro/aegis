/**
 * Swap tools — quote (read-only) and execute (gated, requires approval).
 *
 * `executeSwap` is the ONLY way the agent can move funds. It always:
 *   1. Builds a TradeProposal (StrategyType = 'manual')
 *   2. Runs the policy engine with getDefaultPolicies('manual')
 *   3. If policies deny, returns a structured denial result without signing.
 *   4. If policies pass, attaches the policyResult and calls executeTrade(),
 *      which fails closed if anything later strips the gate.
 *
 * `needsApproval: true` means the chat surface (Telegram or CLI) must
 * obtain explicit human approval before the SDK calls execute(). The
 * policy gate above runs INSIDE execute(), so a misconfigured surface that
 * bypasses approval still cannot bypass policy.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { getSwapQuote as zerionGetSwapQuote } from '../../../cli/utils/trading/swap.js';
import { runPolicies, getDefaultPolicies } from '../../policies/engine.mjs';
import { createTradeProposal } from '../../core/types.mjs';
import { executeTrade, getTxExplorerUrl } from '../../execution/executor.mjs';
import { getEvmAddress, getSolAddress } from '../../../cli/utils/wallet/keystore.js';
import { isSolana } from '../../../cli/utils/chain/registry.js';
import { needsApprovalGate, resolveActiveMission } from './_approval-gate.mjs';
import env from '../../config.mjs';

function activeWalletFromContext(ctx) {
  return ctx?.experimental_context?.walletName || env.DEFAULT_WALLET || 'default';
}

function resolveWalletAddress(walletName, chain) {
  return isSolana(chain) ? getSolAddress(walletName) : getEvmAddress(walletName);
}

export const getSwapQuote = tool({
  description: 'Get a live swap/bridge quote from Zerion without executing. Use this before proposing executeSwap so the user sees real numbers.',
  inputSchema: z.object({
    fromToken: z.string().describe('Source token symbol or address.'),
    toToken: z.string().describe('Destination token symbol or address.'),
    amount: z.string().describe('Amount in source-token units, as a string (e.g. "0.01").'),
    chain: z.string().optional().describe('Chain to swap on. Defaults to solana.'),
    slippage: z.number().optional().describe('Max slippage % (default from config).'),
  }),
  execute: async ({ fromToken, toToken, amount, chain, slippage }, ctx) => {
    const walletName = activeWalletFromContext(ctx);
    const tradeChain = chain || env.DEFAULT_CHAIN;
    const walletAddress = resolveWalletAddress(walletName, tradeChain);
    if (!walletAddress) throw new Error(`Wallet "${walletName}" has no ${tradeChain} address.`);

    const quote = await zerionGetSwapQuote({
      fromToken,
      toToken,
      amount,
      fromChain: tradeChain,
      toChain: tradeChain,
      walletAddress,
      slippage,
    });

    return {
      fromToken,
      toToken,
      amount,
      chain: tradeChain,
      estimatedOutput: quote.estimatedOutput,
      liquiditySource: quote.liquiditySource,
      slippage: quote.slippage,
      priceImpact: quote.priceImpact,
    };
  },
});

export const executeSwap = tool({
  description: 'Execute a real onchain swap through Zerion. Goes through the AEGIS policy engine (limits, cooldown, slippage). Returns the txHash + Solscan/Etherscan URL on success, or a structured denial when a policy refuses.',
  inputSchema: z.object({
    fromToken: z.string(),
    toToken: z.string(),
    amount: z.string().describe('Amount in source-token units as a string.'),
    chain: z.string().optional(),
    slippage: z.number().optional(),
    reason: z.string().optional().describe('Short rationale shown in execution logs.'),
  }),
  needsApproval: needsApprovalGate({ kind: 'agent' }),
  execute: async ({ fromToken, toToken, amount, chain, slippage, reason }, ctx) => {
    const walletName = activeWalletFromContext(ctx);
    const userId = ctx?.experimental_context?.userId || 'agent';
    const tradeChain = chain || env.DEFAULT_CHAIN;
    const mission = await resolveActiveMission(ctx, 'agent');

    const proposal = createTradeProposal({
      strategyId: `agent-${userId}`,
      strategyType: 'manual',
      fromToken: fromToken.toUpperCase(),
      toToken: toToken.toUpperCase(),
      amount,
      chain: tradeChain,
      reason: reason || 'LLM agent swap',
      signal: { type: 'AGENT', userId, source: ctx?.experimental_context?.source },
      policies: mission?.policies || getDefaultPolicies('manual'),
    });
    if (mission) proposal.missionId = mission.id;

    const policyResult = await runPolicies(proposal, proposal.policies);

    if (!policyResult.approved) {
      return {
        success: false,
        denied: true,
        deniedBy: policyResult.deniedBy,
        reason: policyResult.reason,
        proposalId: proposal.id,
      };
    }

    proposal.policyResult = policyResult;

    // Mirror the private-executor cross-token guard up front so the LLM gets
    // a clear conversational message instead of an opaque mid-flow throw.
    // MagicBlock private execution today only supports same-token shielding;
    // a private routed swap from A → B has no DEX leg inside the rollup.
    if (
      policyResult.usePrivate &&
      isSolana(tradeChain) &&
      proposal.fromToken !== proposal.toToken
    ) {
      return {
        success: false,
        denied: true,
        deniedBy: 'private-execution-capability',
        reason:
          `MagicBlock shield supports same-token deposits only — to swap into ${proposal.toToken}, ` +
          `use \`swap\` first (public route), then \`shield\` to move ${proposal.toToken} into the private rollup.`,
        proposalId: proposal.id,
      };
    }

    const result = await executeTrade(proposal, {
      walletName,
      maxSlippage: slippage,
      usePrivate: policyResult.usePrivate,
    });

    return {
      success: result.success,
      txHash: result.txHash,
      explorerUrl: getTxExplorerUrl(result.txHash, tradeChain),
      estimatedOutput: result.estimatedOutput,
      liquiditySource: result.liquiditySource,
      private: result.private,
      error: result.error,
      proposalId: proposal.id,
    };
  },
});
