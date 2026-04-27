/**
 * AEGIS Execution Engine — the last mile.
 *
 * Flow: TradeProposal → run policies → privacy check → route to public or private executor
 *
 * Public path: getSwapQuote → verify slippage → executeSwap (Zerion)
 * Private path: deposit → shield → transfer (MagicBlock)
 *
 * Imports directly from the forked Zerion CLI for swap execution.
 */

import { getSwapQuote, executeSwap } from '../../cli/lib/trading/swap.js';
import { getEvmAddress, getSolAddress, getAgentToken } from '../../cli/lib/wallet/keystore.js';
import { isSolana } from '../../cli/lib/chain/registry.js';
import { createExecutionResult } from '../core/types.mjs';
import { executionLog } from '../core/logger.mjs';
import { logExecution } from '../store/executions.mjs';
import { recordSpend, setCooldown } from '../store/state.mjs';
import { updateDCAPlan } from '../store/plans.mjs';
import { executePrivateTrade } from './private-executor.mjs';
import { shouldUsePrivate } from '../policies/privacy.mjs';
import { getKeypair } from '../lib/keypair.mjs';
import bus from '../core/event-bus.mjs';

/**
 * Execute a trade proposal — the full pipeline.
 * Assumes policies have already been checked (PolicyEngine handles that).
 *
 * Routes to private executor if:
 * - proposal.usePrivate is true (from policy engine)
 * - proposal.forcePrivate is true (strategy-level flag)
 * - shouldUsePrivate() returns true (runtime check)
 *
 * @param {object} proposal - TradeProposal from a strategy
 * @param {object} options
 * @param {string} options.walletName - OWS wallet name
 * @param {number} [options.maxSlippage] - Override max slippage %
 * @param {boolean} [options.usePrivate] - Force private execution
 * @returns {object} ExecutionResult
 */
export async function executeTrade(proposal, { walletName, maxSlippage, usePrivate } = {}) {
  const startTime = Date.now();
  const chain = proposal.chain || 'solana';

  // Determine if we should use private execution
  const goPrivate = usePrivate || proposal.usePrivate || proposal.forcePrivate ||
    shouldUsePrivate(proposal, proposal.policies?.privacy);

  if (goPrivate && isSolana(chain)) {
    executionLog.info({ proposalId: proposal.id, strategy: proposal.strategyType }, 'Routing to private execution');

    // Get keypair from env var
    const keypair = getKeypair();
    if (keypair) {
      return executePrivateTrade(proposal, { keypair, maxSlippage });
    }

    executionLog.warn('Private execution requested but SOLANA_PRIVATE_KEY not set - falling back to public');
  }

  executionLog.info({ proposalId: proposal.id, strategy: proposal.strategyType }, 'Executing trade (public)');

  try {
    // Resolve wallet address for the chain
    const walletAddress = isSolana(chain)
      ? getSolAddress(walletName)
      : getEvmAddress(walletName);

    if (!walletAddress) {
      throw new Error(`No ${chain} address found for wallet "${walletName}"`);
    }

    // Get swap quote from Zerion
    const quote = await getSwapQuote({
      fromToken: proposal.fromToken,
      toToken: proposal.toToken,
      amount: proposal.amount,
      fromChain: chain,
      toChain: chain,
      walletAddress,
      slippage: maxSlippage,
    });

    executionLog.info({
      proposalId: proposal.id,
      from: `${proposal.amount} ${proposal.fromToken}`,
      to: `~${quote.estimatedOutput} ${proposal.toToken}`,
      source: quote.liquiditySource,
    }, 'Quote received');

    // Execute the swap
    const passphrase = getAgentToken();
    if (!passphrase) {
      throw new Error('No agent token configured. Set ZERION_AGENT_TOKEN or run: zerion agent create-token');
    }

    const swapResult = await executeSwap(quote, walletName, passphrase);
    const txHash = swapResult.hash || swapResult.signature || null;

    executionLog.info({
      proposalId: proposal.id,
      txHash,
      elapsed: Date.now() - startTime,
    }, 'Trade executed successfully');

    // Record spend + cooldown
    recordSpend(proposal.strategyId, Number(proposal.amount));
    if (proposal.policies?.cooldownMs) {
      setCooldown(proposal.strategyId, proposal.policies.cooldownMs);
    }

    // Update DCA plan stats if applicable
    if (proposal.strategyType === 'dca' && proposal.strategyId) {
      const plan = await import('../store/plans.mjs').then(m => m.getDCAPlan(proposal.strategyId));
      if (plan) {
        updateDCAPlan(proposal.strategyId, {
          totalExecuted: (plan.totalExecuted || 0) + 1,
          totalSpent: (plan.totalSpent || 0) + Number(proposal.amount),
        });
      }
    }

    const result = createExecutionResult(proposal, {
      success: true,
      txHash,
      quote,
    });

    logExecution(result);

    // Emit execution event for bot notifications
    bus.emit('EXECUTION_COMPLETE', result);

    return result;

  } catch (err) {
    executionLog.error({
      proposalId: proposal.id,
      error: err.message,
      code: err.code,
      elapsed: Date.now() - startTime,
    }, 'Trade execution failed');

    const result = createExecutionResult(proposal, {
      success: false,
      error: err.message,
    });

    logExecution(result);
    bus.emit('EXECUTION_FAILED', result);

    return result;
  }
}

/**
 * Get the explorer URL for a transaction hash.
 */
export function getTxExplorerUrl(txHash, chain) {
  if (!txHash) return null;
  if (isSolana(chain)) return `https://solscan.io/tx/${txHash}`;

  const explorers = {
    ethereum: 'https://etherscan.io/tx/',
    base: 'https://basescan.org/tx/',
    arbitrum: 'https://arbiscan.io/tx/',
    optimism: 'https://optimistic.etherscan.io/tx/',
    polygon: 'https://polygonscan.com/tx/',
    'binance-smart-chain': 'https://bscscan.com/tx/',
    avalanche: 'https://snowtrace.io/tx/',
  };
  const base = explorers[chain] || `https://etherscan.io/tx/`;
  return `${base}${txHash}`;
}
