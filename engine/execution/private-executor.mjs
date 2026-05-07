/**
 * AEGIS Private Executor — MagicBlock private execution pipeline.
 *
 * Current supported flow: deposit the source asset into the MagicBlock shield.
 *
 * Used when privacy policy indicates usePrivate=true.
 */

import {
  MagicBlockClient,
  getTokenMint,
  getTokenDecimals,
} from '../lib/magicblock/client.mjs';
import { createExecutionResult } from '../core/types.mjs';
import { executionLog } from '../core/logger.mjs';
import { logExecution } from '../store/executions.mjs';
import { recordSpend, setCooldown } from '../store/state.mjs';
import { updateDCAPlan, getDCAPlan } from '../store/plans.mjs';
import { updateShieldBalance, recordShieldTransaction } from '../store/shield.mjs';
import bus from '../core/event-bus.mjs';

/**
 * Execute a trade privately through MagicBlock.
 *
 * This path is intentionally strict: it performs a real shield deposit and
 * refuses to pretend a token-for-token swap happened inside MagicBlock when
 * no private DEX leg exists.
 *
 * @param {object} proposal - TradeProposal from a strategy
 * @param {object} options
 * @param {import('@solana/web3.js').Keypair} options.keypair - Wallet keypair for signing
 * @returns {object} ExecutionResult
 */
export async function executePrivateTrade(proposal, { keypair } = {}) {
  const startTime = Date.now();
  executionLog.info(
    { proposalId: proposal.id, strategy: proposal.strategyType },
    'Executing private trade via MagicBlock'
  );

  if (!keypair) {
    throw new Error('Keypair required for private execution');
  }

  try {
    const client = new MagicBlockClient(keypair);

    // Resolve token
    const fromToken = proposal.fromToken?.toUpperCase() || 'USDC';
    const toToken = proposal.toToken?.toUpperCase() || 'SOL';
    const fromMint = getTokenMint(fromToken);
    const toMint = getTokenMint(toToken);

    if (!fromMint) {
      throw new Error(`Unknown token: ${fromToken}`);
    }

    const decimals = getTokenDecimals(fromToken);
    const amountRaw = BigInt(Math.round(Number(proposal.amount) * 10 ** decimals));

    if (fromToken !== toToken) {
      throw new Error(
        `Private execution currently supports shielding ${fromToken} only. ` +
        `Requested swap ${fromToken} -> ${toToken} is not implemented on MagicBlock.`
      );
    }

    // Step 1: Ensure we have shielded balance
    let shieldedBalance = await client.getShieldedBalance(fromMint);
    executionLog.debug({ shieldedBalance: shieldedBalance.toString(), required: amountRaw.toString() }, 'Checking shielded balance');

    let depositSig = null;
    if (shieldedBalance < amountRaw) {
      // Need to deposit more
      const toDeposit = amountRaw - shieldedBalance;
      executionLog.info({ amount: toDeposit.toString(), token: fromToken }, 'Depositing to shield');

      depositSig = await client.deposit(fromMint, toDeposit);
      shieldedBalance = await client.getShieldedBalance(fromMint);

      // Update local shield balance tracking
      await updateShieldBalance(keypair.publicKey.toBase58(), fromToken, shieldedBalance);
      await recordShieldTransaction({
        type: 'deposit',
        wallet: keypair.publicKey.toBase58(),
        token: fromToken,
        amount: amountRaw.toString(),
        signature: depositSig,
      });
    }

    executionLog.info({
      proposalId: proposal.id,
      shieldedBalance: shieldedBalance.toString(),
      depositSig,
      elapsed: Date.now() - startTime,
    }, 'Private shielding complete');

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
      txHash: depositSig,
      private: true,
      shieldedBalance: shieldedBalance.toString(),
      quote: {
        liquiditySource: depositSig ? 'MagicBlock shield deposit' : 'MagicBlock shielded balance',
      },
    });

    await logExecution(result);

    // Emit execution event for bot notifications
    bus.emit('EXECUTION_COMPLETE', result);

    return result;

  } catch (err) {
    executionLog.error({
      proposalId: proposal.id,
      error: err.message,
      stack: err.stack,
      elapsed: Date.now() - startTime,
    }, 'Private trade execution failed');

    const result = createExecutionResult(proposal, {
      success: false,
      error: err.message,
      private: true,
    });

    await logExecution(result);
    bus.emit('EXECUTION_FAILED', result);

    return result;
  }
}

/**
 * Deposit tokens to the MagicBlock shield.
 *
 * @param {Keypair} keypair - Wallet keypair
 * @param {string} token - Token symbol (SOL, USDC, etc.)
 * @param {number} amount - Amount in token units (not raw)
 * @returns {Promise<{ signature: string, balance: bigint }>}
 */
export async function depositToShield(keypair, token, amount) {
  const client = new MagicBlockClient(keypair);
  const mint = getTokenMint(token);
  if (!mint) throw new Error(`Unknown token: ${token}`);

  const decimals = getTokenDecimals(token);
  const amountRaw = BigInt(Math.round(amount * 10 ** decimals));

  const sig = await client.deposit(mint, amountRaw);
  const balance = await client.getShieldedBalance(mint);

  // Update local tracking
  await updateShieldBalance(keypair.publicKey.toBase58(), token, balance);

  return { signature: sig, balance };
}

/**
 * Withdraw tokens from the MagicBlock shield.
 *
 * @param {Keypair} keypair - Wallet keypair
 * @param {string} token - Token symbol
 * @param {number} amount - Amount in token units
 * @returns {Promise<{ signature: string, balance: bigint }>}
 */
export async function withdrawFromShield(keypair, token, amount) {
  const client = new MagicBlockClient(keypair);
  const mint = getTokenMint(token);
  if (!mint) throw new Error(`Unknown token: ${token}`);

  const decimals = getTokenDecimals(token);
  const amountRaw = BigInt(Math.round(amount * 10 ** decimals));

  const sig = await client.withdraw(mint, amountRaw);
  const balance = await client.getShieldedBalance(mint);

  // Update local tracking
  await updateShieldBalance(keypair.publicKey.toBase58(), token, balance);

  return { signature: sig, balance };
}

/**
 * Get shielded balance for a token.
 *
 * @param {Keypair} keypair - Wallet keypair
 * @param {string} token - Token symbol
 * @returns {Promise<bigint>}
 */
export async function getShieldBalance(keypair, token) {
  const client = new MagicBlockClient(keypair);
  const mint = getTokenMint(token);
  if (!mint) throw new Error(`Unknown token: ${token}`);

  return client.getShieldedBalance(mint);
}

/**
 * Get all shielded balances for common tokens.
 *
 * @param {Keypair} keypair - Wallet keypair
 * @returns {Promise<Record<string, bigint>>}
 */
export async function getAllShieldBalances(keypair) {
  const client = new MagicBlockClient(keypair);
  const tokens = ['SOL', 'USDC', 'USDT'];
  const balances = {};

  for (const token of tokens) {
    const mint = getTokenMint(token);
    if (mint) {
      try {
        balances[token] = await client.getShieldedBalance(mint);
      } catch {
        balances[token] = 0n;
      }
    }
  }

  return balances;
}
