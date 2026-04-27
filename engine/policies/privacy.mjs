/**
 * Privacy Policy — decides when trades should use private (MagicBlock) execution.
 *
 * Routes trades through MagicBlock's Private Payments API when:
 * - Amount exceeds PRIVACY_THRESHOLD_USD
 * - Token is in PRIVACY_TOKENS list
 * - Strategy has forcePrivate flag
 * - PRIVACY_MODE is 'on'
 *
 * Follows Zerion policy contract: check(ctx) => { allow: boolean, reason?: string, usePrivate?: boolean }
 */

import env from '../config.mjs';
import { policyLog } from '../core/logger.mjs';

/**
 * Parse the comma-separated privacy tokens list from env.
 */
function getPrivacyTokens() {
  const raw = env.PRIVACY_TOKENS || 'SOL,USDC';
  return raw.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
}

/**
 * Check if a trade should use private execution.
 *
 * @param {object} ctx - Policy context
 * @param {object} ctx.transaction - Transaction details
 * @param {object} ctx.policy_config - Policy-specific config
 * @param {object} ctx.proposal - Full trade proposal
 * @returns {{ allow: boolean, reason?: string, usePrivate: boolean }}
 */
export function check(ctx) {
  const { transaction, policy_config, proposal } = ctx;
  const config = policy_config || {};

  // Privacy mode: off, on, auto
  const mode = config.mode || env.PRIVACY_MODE || 'auto';

  // Always allow the trade (this policy doesn't block, it routes)
  const baseResult = { allow: true };

  // Mode: off — never use private
  if (mode === 'off') {
    return { ...baseResult, usePrivate: false, reason: 'Privacy mode is off' };
  }

  // Mode: on — always use private
  if (mode === 'on') {
    return { ...baseResult, usePrivate: true, reason: 'Privacy mode is on' };
  }

  // Mode: auto — check conditions
  const amount = Number(proposal?.amount || transaction?.amount || 0);
  const token = (transaction?.to || proposal?.toToken || '').toUpperCase();
  const fromToken = (transaction?.from || proposal?.fromToken || '').toUpperCase();

  // Check strategy-level forcePrivate flag
  if (proposal?.forcePrivate || config.forcePrivate) {
    policyLog.debug({ proposalId: proposal?.id }, 'Strategy forces private execution');
    return { ...baseResult, usePrivate: true, reason: 'Strategy configured for private execution' };
  }

  // Check amount threshold
  const threshold = config.thresholdUsd || env.PRIVACY_THRESHOLD_USD || 100;
  if (amount >= threshold) {
    policyLog.debug({ proposalId: proposal?.id, amount, threshold }, 'Amount exceeds privacy threshold');
    return {
      ...baseResult,
      usePrivate: true,
      reason: `Amount $${amount} exceeds private threshold $${threshold}`,
    };
  }

  // Check token list
  const privateTokens = config.privateTokens || getPrivacyTokens();
  if (privateTokens.includes(token) || privateTokens.includes(fromToken)) {
    policyLog.debug({ proposalId: proposal?.id, token }, 'Token in privacy list');
    return {
      ...baseResult,
      usePrivate: true,
      reason: `${token || fromToken} is configured for private execution`,
    };
  }

  // Default: public execution
  return { ...baseResult, usePrivate: false, reason: 'Below privacy threshold' };
}

/**
 * Get the current privacy configuration.
 */
export function getPrivacyConfig() {
  return {
    mode: env.PRIVACY_MODE,
    thresholdUsd: env.PRIVACY_THRESHOLD_USD,
    privateTokens: getPrivacyTokens(),
  };
}

/**
 * Determine if a trade should use private execution (convenience function).
 *
 * @param {object} proposal - Trade proposal
 * @param {object} [policyConfig] - Optional policy config override
 * @returns {boolean}
 */
export function shouldUsePrivate(proposal, policyConfig = {}) {
  const ctx = {
    transaction: {
      from: proposal.fromToken,
      to: proposal.toToken,
      amount: proposal.amount,
      chain: proposal.chain,
    },
    policy_config: policyConfig,
    proposal,
  };
  const result = check(ctx);
  return result.usePrivate;
}

export default {
  name: 'privacy',
  check,
  getPrivacyConfig,
  shouldUsePrivate,
};
