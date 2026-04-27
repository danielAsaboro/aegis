/**
 * Inline keyboards for Telegram bot flows.
 */

import { Markup } from 'telegraf';

// ─── DCA Keyboards ───────────────────────────────────────────────────────────

export function dcaTokenKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('SOL', 'dca_token_SOL'), Markup.button.callback('ETH', 'dca_token_ETH')],
    [Markup.button.callback('BTC', 'dca_token_BTC'), Markup.button.callback('Custom...', 'dca_token_custom')],
  ]);
}

export function dcaAmountKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('$1', 'dca_amount_1'), Markup.button.callback('$5', 'dca_amount_5')],
    [Markup.button.callback('$10', 'dca_amount_10'), Markup.button.callback('$25', 'dca_amount_25')],
    [Markup.button.callback('Custom...', 'dca_amount_custom')],
  ]);
}

export function dcaIntervalKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Every 1 min', 'dca_cron_*/1 * * * *'), Markup.button.callback('Every 5 min', 'dca_cron_*/5 * * * *')],
    [Markup.button.callback('Every hour', 'dca_cron_0 * * * *'), Markup.button.callback('Every 4 hours', 'dca_cron_0 */4 * * *')],
    [Markup.button.callback('Daily', 'dca_cron_0 12 * * *'), Markup.button.callback('Weekly', 'dca_cron_0 12 * * 1')],
  ]);
}

export function dcaChainKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Solana', 'dca_chain_solana'), Markup.button.callback('Base', 'dca_chain_base')],
    [Markup.button.callback('Ethereum', 'dca_chain_ethereum'), Markup.button.callback('Arbitrum', 'dca_chain_arbitrum')],
  ]);
}

export function dcaManageKeyboard(planId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⏸ Pause', `dca_pause_${planId}`), Markup.button.callback('▶️ Resume', `dca_resume_${planId}`)],
    [Markup.button.callback('🗑 Cancel', `dca_cancel_${planId}`)],
  ]);
}

// ─── Alert Keyboards ─────────────────────────────────────────────────────────

export function alertTypeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📉 Dip Buyer', 'alert_type_dip-buyer')],
    [Markup.button.callback('📈 Take Profit', 'alert_type_take-profit')],
    [Markup.button.callback('🔔 Alert Only', 'alert_type_alert-only')],
  ]);
}

export function alertThresholdKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('3%', 'alert_thresh_3'), Markup.button.callback('5%', 'alert_thresh_5')],
    [Markup.button.callback('10%', 'alert_thresh_10'), Markup.button.callback('15%', 'alert_thresh_15')],
    [Markup.button.callback('Custom...', 'alert_thresh_custom')],
  ]);
}

// ─── Trade Keyboards ─────────────────────────────────────────────────────────

export function confirmTradeKeyboard(tradeId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Confirm', `trade_confirm_${tradeId}`), Markup.button.callback('❌ Cancel', `trade_cancel_${tradeId}`)],
  ]);
}

// ─── Proposal Keyboards ──────────────────────────────────────────────────────

export function voteKeyboard(proposalId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Approve', `vote_approve_${proposalId}`),
      Markup.button.callback('❌ Reject', `vote_reject_${proposalId}`),
    ],
  ]);
}

// ─── Rebalance Keyboards ────────────────────────────────────────────────────

export function rebalanceChainKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Solana', 'rebal_chain_solana'), Markup.button.callback('Base', 'rebal_chain_base')],
    [Markup.button.callback('Ethereum', 'rebal_chain_ethereum')],
  ]);
}
