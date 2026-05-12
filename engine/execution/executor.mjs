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

import { getSwapQuote, executeSwap } from '../../cli/utils/trading/swap.js';
import { getEvmAddress, getSolAddress, getAgentToken } from '../../cli/utils/wallet/keystore.js';
import { isSolana } from '../../cli/utils/chain/registry.js';
import { createExecutionResult } from '../core/types.mjs';
import { executionLog } from '../core/logger.mjs';
import { logExecution } from '../store/executions.mjs';
import { recordSpend, setCooldown } from '../store/state.mjs';
import { updateDCAPlan, getDCAPlan } from '../store/plans.mjs';
import { executePrivateTrade } from './private-executor.mjs';
import { shouldUsePrivate } from '../policies/privacy.mjs';
import { getKeypair } from '../lib/keypair.mjs';
import { recordMissionTrade } from '../missions/index.mjs';
import bus from '../core/event-bus.mjs';

const ADVISORY_HALT_CODES = new Set([
  'missing_agent_token',
  'missing_wallet_address',
  'insufficient_balance',
  'unsupported_private_route',
  'quote_blocked',
]);

function createFailedResult(proposal, { error, errorCode, quote, advisoryHalt = false }) {
  return createExecutionResult(proposal, {
    success: false,
    error,
    errorCode,
    quote,
    advisoryHalt,
  });
}

async function finalizeFailure(proposal, opts) {
  const result = createFailedResult(proposal, opts);
  await logExecution(result);
  bus.emit('EXECUTION_FAILED', result);
  return result;
}

function getWalletAddress(walletName, chain) {
  return isSolana(chain)
    ? getSolAddress(walletName)
    : getEvmAddress(walletName);
}

function classifyPrivateRouting({ proposal, usePrivate }) {
  const policyRequestedPrivate = usePrivate === true || proposal.usePrivate === true;
  const strategyForcedPrivate = proposal.forcePrivate === true;
  return {
    goPrivate: policyRequestedPrivate || strategyForcedPrivate || shouldUsePrivate(proposal, proposal.policies?.privacy),
    policyRequestedPrivate,
    strategyForcedPrivate,
  };
}

function unsupportedPrivateRouteMessage(proposal) {
  return (
    `Private execution does not support ${proposal.fromToken} -> ${proposal.toToken} yet. ` +
    `MagicBlock shielding currently handles same-token private routing only.`
  );
}

export function isAdvisoryExecutionFailure(result) {
  return !!result?.advisoryHalt || ADVISORY_HALT_CODES.has(result?.errorCode);
}

export function getExecutionFailureGuidance(result) {
  switch (result?.errorCode) {
    case 'missing_agent_token':
      return 'Create or attach an agent token, then retry the plan.';
    case 'missing_wallet_address':
      return `Configure wallet "${result?.walletName || 'default'}" for the target chain, then retry.`;
    case 'insufficient_balance':
      return `Fund the wallet with more ${result?.fromToken || 'source token'} before the next tick.`;
    case 'unsupported_private_route':
      return 'Disable private routing for this plan or use a supported same-token shield flow.';
    case 'quote_blocked':
      return 'Check the quote preconditions and wallet state, then retry.';
    default:
      return 'Check daemon logs for the exact failure and retry after remediation.';
  }
}

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

  // Defensive: refuse to execute a trade that wasn't gated by the policy engine.
  // Callers must attach proposal.policyResult after a successful runPolicies() call.
  if (!proposal.policyResult || proposal.policyResult.approved !== true) {
    const err = new Error(
      `executeTrade refused: proposal ${proposal.id} has no approved policyResult. ` +
      `Run policies via runPolicies() and attach the result before calling the executor.`
    );
    err.code = 'no_policy_result';
    throw err;
  }

  // Determine if we should use private execution
  const { goPrivate, policyRequestedPrivate, strategyForcedPrivate } = classifyPrivateRouting({
    proposal,
    usePrivate,
  });

  if (goPrivate && isSolana(chain)) {
    if (proposal.fromToken !== proposal.toToken) {
      if (policyRequestedPrivate || strategyForcedPrivate) {
        return finalizeFailure(proposal, {
          error: unsupportedPrivateRouteMessage(proposal),
          errorCode: 'unsupported_private_route',
          advisoryHalt: true,
        });
      }

      executionLog.warn({
        proposalId: proposal.id,
        fromToken: proposal.fromToken,
        toToken: proposal.toToken,
      }, 'Private route unsupported for pair; falling back to public execution');
    } else {
      executionLog.info({ proposalId: proposal.id, strategy: proposal.strategyType }, 'Routing to private execution');

      // Get keypair from env var
      const keypair = getKeypair();
      if (keypair) {
        return executePrivateTrade(proposal, { keypair, maxSlippage });
      }

      executionLog.warn('Private execution requested but SOLANA_PRIVATE_KEY not set - falling back to public');
    }
  }

  executionLog.info({ proposalId: proposal.id, strategy: proposal.strategyType }, 'Executing trade (public)');

  try {
    // Resolve wallet address for the chain
    let walletAddress = null;
    try {
      walletAddress = getWalletAddress(walletName, chain);
    } catch (err) {
      executionLog.warn({
        proposalId: proposal.id,
        walletName,
        chain,
        error: err.message,
      }, 'wallet resolution failed');
    }

    if (!walletAddress) {
      return finalizeFailure(proposal, {
        error: `No ${chain} address found for wallet "${walletName}"`,
        errorCode: 'missing_wallet_address',
        advisoryHalt: true,
      });
    }

    // Missing token is operator-error, so fail fast before quote/execution.
    const passphrase = getAgentToken();
    if (!passphrase) {
      return finalizeFailure(proposal, {
        error: 'No agent token configured. Set ZERION_AGENT_TOKEN or run: zerion agent create-token',
        errorCode: 'missing_agent_token',
        advisoryHalt: true,
      });
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

    if (quote.preconditions?.enough_balance === false) {
      return finalizeFailure(proposal, {
        error: `Insufficient ${proposal.fromToken} balance for this trade`,
        errorCode: 'insufficient_balance',
        quote,
        advisoryHalt: true,
      });
    }

    if (quote.blocking) {
      return finalizeFailure(proposal, {
        error:
          `Quote blocked: ${quote.blocking.message || quote.blocking.code}` +
          (quote.blocking.hint ? ` (${quote.blocking.hint})` : ''),
        errorCode: quote.blocking.code || 'quote_blocked',
        quote,
        advisoryHalt: quote.blocking.code === 'not_enough_input_asset_balance' || quote.blocking.code === 'quote_blocked',
      });
    }

    executionLog.info({
      proposalId: proposal.id,
      from: `${proposal.amount} ${proposal.fromToken}`,
      to: `~${quote.estimatedOutput} ${proposal.toToken}`,
      source: quote.liquiditySource,
    }, 'Quote received');

    const swapResult = await executeSwap(quote, walletName, passphrase);
    const txHash = swapResult.hash || swapResult.signature || null;

    executionLog.info({
      proposalId: proposal.id,
      txHash,
      elapsed: Date.now() - startTime,
    }, 'Trade executed successfully');

    // Record spend + cooldown
    await recordSpend(proposal.strategyId, Number(proposal.amount));
    if (proposal.policies?.cooldownMs) {
      await setCooldown(proposal.strategyId, proposal.policies.cooldownMs);
    }

    // Update DCA plan stats if applicable
    if (proposal.strategyType === 'dca' && proposal.strategyId) {
      const plan = await getDCAPlan(proposal.strategyId);
      if (plan) {
        await updateDCAPlan(proposal.strategyId, {
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
    if (proposal.missionId) result.missionId = proposal.missionId;

    await logExecution(result);

    if (proposal.missionId) {
      try {
        await recordMissionTrade({
          missionId: proposal.missionId,
          executionId: result.id,
          amountUsd: Number(proposal.amount),
          txHash,
        });
      } catch (err) {
        executionLog.warn({ missionId: proposal.missionId, err: err.message }, 'recordMissionTrade failed');
      }
    }

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

    return finalizeFailure(proposal, {
      error: err.message,
      errorCode: err.code || 'execution_transport_error',
    });
  }
}

/**
 * Get the explorer URL for a transaction hash.
 */
export function getTxExplorerUrl(txHash, chain) {
  if (!txHash) return null;
  if (isSolana(chain)) return `https://explorer.solana.com/tx/${txHash}`;

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
