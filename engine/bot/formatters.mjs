/**
 * Telegram message formatters — Markdown formatting for all bot outputs.
 */

import { getTxExplorerUrl } from '../execution/executor.mjs';

export function formatWelcome(walletName, evmAddr, solAddr) {
  return [
    `*AEGIS* — Autonomous Execution Governed by Intelligence Signals\n`,
    `Wallet: \`${walletName}\``,
    evmAddr ? `EVM: \`${evmAddr}\`` : '',
    solAddr ? `SOL: \`${solAddr}\`` : '',
    ``,
    `*Commands:*`,
    `/dca — DCA plans (create, list, pause, cancel)`,
    `/rebalance — Portfolio rebalancing`,
    `/alerts — Price alerts & auto-trading`,
    `/trade — Manual swap`,
    `/propose — Group trade proposal`,
    `/vote — Vote on proposals`,
    `/status — Portfolio + active strategies`,
    `/history — Execution log`,
    `/policy — Active policies`,
    `/whale — Whale tracking`,
    `/shield — Private balance (MagicBlock)`,
  ].filter(Boolean).join('\n');
}

export function formatDCAPlan(plan) {
  const status = plan.status === 'active' ? '🟢' : plan.status === 'paused' ? '🟡' : '🔴';
  const privacyBadge = plan.forcePrivate ? ' 🔒' : '';
  return [
    `${status} *DCA Plan* \`${plan.id}\`${privacyBadge}`,
    `${plan.fromToken} → ${plan.toToken} | $${plan.amount} per tick`,
    `Chain: ${plan.chain} | Cron: \`${plan.cron}\``,
    `Executed: ${plan.totalExecuted || 0} | Spent: $${(plan.totalSpent || 0).toFixed(2)}`,
    `Status: ${plan.status}${plan.forcePrivate ? ' (private)' : ''}`,
  ].join('\n');
}

export function formatDCAList(plans) {
  if (plans.length === 0) return 'No DCA plans. Create one with /dca';
  return plans.map(formatDCAPlan).join('\n\n');
}

export function formatExecution(result) {
  const icon = result.success ? '✅' : '❌';
  const url = result.txHash ? getTxExplorerUrl(result.txHash, result.chain) : null;
  const privacyBadge = result.private ? '🔒 PRIVATE' : '';

  return [
    `${icon} *Trade ${result.success ? 'Executed' : 'Failed'}* ${privacyBadge}`,
    `${result.amount} ${result.fromToken} → ${result.toToken}`,
    result.estimatedOutput ? `Est. output: ~${result.estimatedOutput}` : '',
    result.liquiditySource ? `Source: ${result.liquiditySource}` : '',
    `Strategy: ${result.strategyType} | ${result.reason}`,
    result.txHash ? `[View tx](${url})` : '',
    result.shieldedBalance ? `Shielded: ${result.shieldedBalance}` : '',
    result.error ? `Error: ${result.error}` : '',
  ].filter(Boolean).join('\n');
}

export function formatDenied(proposal, deniedBy, reason) {
  return [
    `⛔ *Trade Denied*`,
    `${proposal.amount} ${proposal.fromToken} → ${proposal.toToken}`,
    `Strategy: ${proposal.strategyType}`,
    `Blocked by: *${deniedBy}*`,
    `Reason: ${reason}`,
  ].join('\n');
}

export function formatHistory(executions) {
  if (executions.length === 0) return 'No executions yet.';
  return executions.map((e, i) => {
    const icon = e.success ? '✅' : '❌';
    const time = new Date(e.timestamp).toLocaleString('en-US', { timeZone: 'UTC', hour12: false });
    const url = e.txHash ? getTxExplorerUrl(e.txHash, e.chain) : null;
    return [
      `${icon} ${time} UTC`,
      `${e.amount} ${e.fromToken} → ${e.toToken} (${e.strategyType})`,
      url ? `[tx](${url})` : '',
    ].filter(Boolean).join(' | ');
  }).join('\n');
}

export function formatPortfolio(positions, totalValue) {
  const lines = [`*Portfolio* — $${totalValue.toFixed(2)} total\n`];
  for (const p of positions.slice(0, 10)) {
    const pct = p.allocation.toFixed(1);
    const bar = '█'.repeat(Math.round(p.allocation / 5)) + '░'.repeat(Math.max(0, 20 - Math.round(p.allocation / 5)));
    lines.push(`\`${bar}\` ${pct}% ${p.token} — $${p.value.toFixed(2)}`);
  }
  return lines.join('\n');
}

export function formatRebalanceStatus(target, positions) {
  const lines = [`*Rebalance Target* — ${target.chain}\n`];
  for (const t of target.targets) {
    const current = positions.find(p => p.token.toUpperCase() === t.token.toUpperCase());
    const actual = current?.allocation || 0;
    const delta = actual - t.weight;
    const icon = Math.abs(delta) >= target.threshold ? '⚠️' : '✅';
    lines.push(`${icon} ${t.token}: ${actual.toFixed(1)}% / ${t.weight}% (${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%)`);
  }
  return lines.join('\n');
}

export function formatPolicies(policyConfig) {
  const lines = ['*Active Policies*\n'];
  for (const [name, config] of Object.entries(policyConfig)) {
    lines.push(`• *${name}*: ${JSON.stringify(config)}`);
  }
  if (lines.length === 1) lines.push('No policies configured');
  return lines.join('\n');
}

export function formatProposal(proposal) {
  const approvals = Object.values(proposal.votes).filter(v => v === 'approve').length;
  const rejections = Object.values(proposal.votes).filter(v => v === 'reject').length;
  const expires = new Date(proposal.expiresAt).toLocaleString('en-US', { timeZone: 'UTC', hour12: false });
  return [
    `*Trade Proposal* \`${proposal.id}\``,
    `By: ${proposal.proposerName}`,
    `Swap: ${proposal.amount} ${proposal.fromToken} → ${proposal.toToken}`,
    `Chain: ${proposal.chain}`,
    `Votes: ✅ ${approvals} / ❌ ${rejections} (need ${proposal.requiredVotes})`,
    `Expires: ${expires} UTC`,
  ].join('\n');
}

export function formatAlertList(alerts) {
  if (alerts.length === 0) return 'No price alerts. Create one with /alerts';
  return alerts.map(a => {
    const icon = a.status === 'active' ? '🟢' : '🔴';
    const dir = a.direction === 'below' ? '📉' : '📈';
    return [
      `${icon} ${dir} *${a.token}* ${a.direction} ${a.threshold}%`,
      `Type: ${a.type} | Chain: ${a.chain}`,
      a.buyToken ? `Action: Buy ${a.buyAmount} ${a.buyToken}` : 'Alert only',
      a.referencePrice ? `Ref price: $${a.referencePrice}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

export function formatWhaleActivity(signal) {
  const icon = signal.type === 'WHALE_BUY' ? '🐳📈' : '🐳📉';
  return [
    `${icon} *Whale ${signal.type === 'WHALE_BUY' ? 'Buy' : 'Sell'}*`,
    `Wallet: ${signal.label}`,
    `Token: ${signal.token} | Value: $${signal.value?.toFixed(2) || '?'}`,
  ].join('\n');
}

export function formatWhaleList(watches) {
  if (watches.length === 0) return 'No whale watches. Add one with /whale watch <address>';
  return watches.map(w => {
    return `• \`${w.address.slice(0, 8)}...${w.address.slice(-4)}\` ${w.label || ''}`;
  }).join('\n');
}

// ─── Shield / Privacy Formatters ─────────────────────────────────────────────

const TOKEN_DECIMALS = { SOL: 9, USDC: 6, USDT: 6 };

/**
 * Format shielded balances display.
 *
 * @param {Record<string, bigint>} balances - Token -> raw balance map
 * @returns {string}
 */
export function formatShieldBalances(balances) {
  const tokens = Object.keys(balances);
  if (tokens.length === 0) {
    return '🔒 *Shielded Balances*\n\nNo shielded tokens. Use `/shield deposit <amount> <token>` to get started.';
  }

  const lines = ['🔒 *Shielded Balances* (MagicBlock)\n'];
  for (const token of tokens) {
    const raw = balances[token];
    const decimals = TOKEN_DECIMALS[token] || 9;
    const amount = Number(raw) / 10 ** decimals;
    if (amount > 0) {
      lines.push(`• *${token}*: ${amount.toFixed(decimals > 6 ? 4 : 2)}`);
    }
  }

  if (lines.length === 1) {
    lines.push('No shielded tokens with balance.');
  }

  return lines.join('\n');
}

/**
 * Format a shield deposit result.
 */
export function formatShieldDeposit(token, amount, signature, newBalance) {
  const decimals = TOKEN_DECIMALS[token] || 9;
  const balanceDisplay = Number(newBalance) / 10 ** decimals;
  const url = signature ? `https://solscan.io/tx/${signature}` : null;

  return [
    `✅ *Deposited to Shield*`,
    `${amount} ${token} → 🔒 Private Balance`,
    `New shielded balance: ${balanceDisplay.toFixed(decimals > 6 ? 4 : 2)} ${token}`,
    url ? `[View tx](${url})` : '',
  ].filter(Boolean).join('\n');
}

/**
 * Format a shield withdraw result.
 */
export function formatShieldWithdraw(token, amount, signature, newBalance) {
  const decimals = TOKEN_DECIMALS[token] || 9;
  const balanceDisplay = Number(newBalance) / 10 ** decimals;
  const url = signature ? `https://solscan.io/tx/${signature}` : null;

  return [
    `✅ *Withdrawn from Shield*`,
    `${amount} ${token} → 📤 Wallet`,
    `Remaining shielded: ${balanceDisplay.toFixed(decimals > 6 ? 4 : 2)} ${token}`,
    url ? `[View tx](${url})` : '',
  ].filter(Boolean).join('\n');
}

/**
 * Format shield transaction history.
 */
export function formatShieldHistory(transactions) {
  if (transactions.length === 0) {
    return '🔒 *Shield History*\n\nNo transactions yet.';
  }

  const lines = ['🔒 *Shield History*\n'];
  for (const tx of transactions.slice(0, 10)) {
    const icon = tx.type === 'deposit' ? '📥' : tx.type === 'withdraw' ? '📤' : '↔️';
    const time = new Date(tx.timestamp).toLocaleString('en-US', { timeZone: 'UTC', hour12: false });
    const decimals = TOKEN_DECIMALS[tx.token] || 9;
    const amount = Number(tx.amount) / 10 ** decimals;

    lines.push(`${icon} ${time} | ${tx.type} ${amount.toFixed(2)} ${tx.token}`);
  }

  return lines.join('\n');
}

/**
 * Format privacy settings display.
 */
export function formatPrivacySettings(config) {
  const modeEmoji = config.mode === 'on' ? '🔒' : config.mode === 'off' ? '🔓' : '🔄';

  return [
    `*Privacy Settings* ${modeEmoji}\n`,
    `Mode: *${config.mode}*`,
    config.mode === 'auto' ? `Threshold: $${config.thresholdUsd}` : '',
    `Private tokens: ${config.privateTokens.join(', ') || 'none'}`,
    ``,
    `_Use /shield settings <mode> to change_`,
    `_Modes: off (public), on (always private), auto (threshold-based)_`,
  ].filter(Boolean).join('\n');
}
