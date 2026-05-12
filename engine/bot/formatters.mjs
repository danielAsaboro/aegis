/**
 * Telegram message formatters.
 *
 * Curated slash-command formatters still return Telegram Markdown. Natural
 * language agent replies go through the HTML renderer below so model-authored
 * Markdown never leaks to users.
 */

import { getTxExplorerUrl } from '../execution/executor.mjs';

const TELEGRAM_HTML_MODE = 'HTML';

function humanizeLabel(raw) {
  const label = String(raw || '')
    .trim()
    .replace(/^`|`$/g, '')
    .replace(/^\*+|\*+$/g, '')
    .replace(/^_+|_+$/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!label) return '';
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function shouldKeepCodeSpan(raw) {
  const text = String(raw || '').trim();
  if (!text) return false;
  if (/^\/[a-z0-9_-]+(?:\s+[^\s]+)*$/i.test(text)) return true;
  if (/^(?:\.{0,2}\/|~\/|\/)[\w./-]+$/.test(text)) return true;
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(text)) return true;
  if (/^--?[a-z0-9][\w-]*(?:[= ][^\s]+)?$/i.test(text)) return true;
  if (/^\.[\w.-]+$/.test(text)) return true;
  if (/^[\w.-]+\.[\w./-]+$/.test(text)) return true;
  if (/^0x[a-f0-9]{8,}$/i.test(text)) return true;
  if (/^[1-9A-HJ-NP-Za-km-z]{20,}$/.test(text)) return true;
  if (/^[a-z]+-\d[\w-]*$/i.test(text)) return true;
  if (/^[A-Za-z0-9_-]{10,}$/.test(text) && /\d/.test(text)) return true;
  return false;
}

function escapeTelegramHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeTelegramAttr(value) {
  return escapeTelegramHtml(value).replace(/"/g, '&quot;');
}

function isSafeHttpUrl(raw) {
  try {
    const url = new URL(String(raw || '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function stripDecorativeMarkdown(text) {
  return String(text || '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/(^|[^\w`])_([^_\n]+)_([^\w`]|$)/g, '$1$2$3')
    .replace(/`([^`\n]+)`/g, '$1')
    .trim();
}

function cleanInlineMarkup(text) {
  return String(text || '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/(^|[^\w`])_([^_\n]+)_([^\w`]|$)/g, '$1$2$3')
    .trim();
}

function unwrapFencedBlock(body) {
  const trimmed = String(body || '').trim();
  if (!trimmed) return '';
  const lines = trimmed.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length === 1 && shouldKeepCodeSpan(lines[0])) return lines[0];
  return lines.join('\n');
}

function normalizeAgentText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/```(?:[a-z0-9_-]+)?\n?([\s\S]*?)```/gi, (_, body) => unwrapFencedBlock(body))
    .trim();
}

function parseMarkdownLinkLine(line) {
  const match = line.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
  if (!match) return null;
  return { label: stripDecorativeMarkdown(match[1]), url: match[2].trim() };
}

function parseLabeledBody(raw) {
  const body = String(raw || '').trim();
  const labelMatch = body.match(/^(`[^`]+`|\*\*[^*]+\*\*|[^:]{1,48}):\s+(.+)$/);
  if (!labelMatch) return null;
  const label = humanizeLabel(labelMatch[1]);
  const value = cleanInlineMarkup(labelMatch[2]);
  if (!label || !value) return null;
  return { label, text: value };
}

function normalizeTelegramAgentBlocks(text) {
  const normalized = normalizeAgentText(text);
  if (!normalized) return [];

  const blocks = [];
  for (const rawLine of normalized.split('\n')) {
    let line = String(rawLine || '').trim();

    if (!line) {
      if (blocks.length && blocks[blocks.length - 1].type !== 'blank') {
        blocks.push({ type: 'blank' });
      }
      continue;
    }

    line = line.replace(/^>\s?/, '').trim();

    if (/^#{1,6}\s+/.test(line)) {
      const text = stripDecorativeMarkdown(line.replace(/^#{1,6}\s+/, ''));
      if (text) blocks.push({ type: 'heading', text });
      continue;
    }

    const boldHeadingMatch = line.match(/^\*\*([^*\n]{1,80})\*\*:?$/);
    if (boldHeadingMatch) {
      const text = stripDecorativeMarkdown(boldHeadingMatch[1]);
      if (text) blocks.push({ type: 'heading', text });
      continue;
    }

    const bulletMatch = line.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (bulletMatch) {
      const labeled = parseLabeledBody(bulletMatch[1]);
      if (labeled) {
        blocks.push({ type: 'labeled-bullet', ...labeled });
      } else {
        blocks.push({ type: 'bullet', text: cleanInlineMarkup(bulletMatch[1]) });
      }
      continue;
    }

    const link = parseMarkdownLinkLine(line);
    if (link) {
      blocks.push({ type: 'link', ...link });
      continue;
    }

    const labeled = parseLabeledBody(line);
    if (labeled) {
      blocks.push({ type: 'value', ...labeled });
      continue;
    }

    const stripped = stripDecorativeMarkdown(line);
    if (shouldKeepCodeSpan(stripped)) {
      blocks.push({ type: 'code-line', text: stripped });
    } else {
      blocks.push({ type: 'paragraph', text: cleanInlineMarkup(line) });
    }
  }

  while (blocks.at(-1)?.type === 'blank') blocks.pop();
  return blocks;
}

function renderInlineHtml(text) {
  const raw = String(text || '');
  let out = '';
  let cursor = 0;
  const tokenPattern = /(`([^`\n]+)`)|\[([^\]]+)\]\(([^)\s]+)\)/g;
  for (const match of raw.matchAll(tokenPattern)) {
    out += escapeTelegramHtml(raw.slice(cursor, match.index));
    if (match[2] != null) {
      const value = match[2].trim();
      out += shouldKeepCodeSpan(value) ? `<code>${escapeTelegramHtml(value)}</code>` : escapeTelegramHtml(value);
    } else {
      const label = stripDecorativeMarkdown(match[3]);
      const url = match[4].trim();
      if (isSafeHttpUrl(url)) {
        out += `<a href="${escapeTelegramAttr(url)}">${escapeTelegramHtml(label)}</a>`;
      } else {
        out += `${escapeTelegramHtml(label)}: ${escapeTelegramHtml(url)}`;
      }
    }
    cursor = match.index + match[0].length;
  }
  out += escapeTelegramHtml(raw.slice(cursor));
  return out;
}

function renderInlinePlain(text) {
  return String(text || '')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => `${stripDecorativeMarkdown(label)}: ${url.trim()}`)
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/(^|[^\w`])_([^_\n]+)_([^\w`]|$)/g, '$1$2$3')
    .trim();
}

function renderBlocks(blocks, mode) {
  const html = mode === 'html';
  const lines = [];

  for (const block of blocks) {
    if (block.type === 'blank') {
      if (lines.length && lines[lines.length - 1] !== '') lines.push('');
      continue;
    }

    if (block.type === 'heading') {
      lines.push(html ? `<b>${escapeTelegramHtml(block.text)}</b>` : block.text);
      continue;
    }

    if (block.type === 'labeled-bullet') {
      const label = html ? `<b>${escapeTelegramHtml(block.label)}:</b>` : `${block.label}:`;
      const body = html ? renderInlineHtml(block.text) : renderInlinePlain(block.text);
      lines.push(`• ${label} ${body}`.trim());
      continue;
    }

    if (block.type === 'bullet') {
      lines.push(`• ${html ? renderInlineHtml(block.text) : renderInlinePlain(block.text)}`);
      continue;
    }

    if (block.type === 'value') {
      const label = html ? `<b>${escapeTelegramHtml(block.label)}:</b>` : `${block.label}:`;
      const body = html ? renderInlineHtml(block.text) : renderInlinePlain(block.text);
      lines.push(`${label} ${body}`.trim());
      continue;
    }

    if (block.type === 'code-line') {
      lines.push(html ? `<code>${escapeTelegramHtml(block.text)}</code>` : block.text);
      continue;
    }

    if (block.type === 'link') {
      if (html && isSafeHttpUrl(block.url)) {
        lines.push(`<a href="${escapeTelegramAttr(block.url)}">${escapeTelegramHtml(block.label)}</a>`);
      } else {
        lines.push(`${renderInlinePlain(block.label)}: ${block.url}`);
      }
      continue;
    }

    lines.push(html ? renderInlineHtml(block.text) : renderInlinePlain(block.text));
  }

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

export function renderTelegramAgentHtml(text) {
  return renderBlocks(normalizeTelegramAgentBlocks(text), 'html');
}

export function renderTelegramAgentPlain(text) {
  return renderBlocks(normalizeTelegramAgentBlocks(text), 'plain');
}

export function formatTelegramAgentReply(text) {
  return renderTelegramAgentHtml(text);
}

export function telegramMarkdownToPlainText(text) {
  return renderTelegramAgentPlain(text);
}

function isTelegramParseError(err) {
  const msg = String(err?.description || err?.message || '');
  return /can't parse entities|parse entities|entity beginning|unsupported start tag/i.test(msg);
}

export async function sendTelegramReply(send, text, extra = {}) {
  const rendered = renderTelegramAgentHtml(text);
  const withHtml = { ...extra, parse_mode: TELEGRAM_HTML_MODE };
  try {
    return await send(rendered, withHtml);
  } catch (err) {
    if (!isTelegramParseError(err)) throw err;
    const plainExtra = { ...extra };
    delete plainExtra.parse_mode;
    return send(renderTelegramAgentPlain(text), plainExtra);
  }
}

export function formatWelcome(walletName, evmAddr, solAddr) {
  return [
    `*AEGIS* — Autonomous Execution Governed by Intelligence Signals\n`,
    `Wallet: \`${walletName}\``,
    evmAddr ? `EVM: \`${evmAddr}\`` : '',
    solAddr ? `SOL: \`${solAddr}\`` : '',
    ``,
    `*Commands:*`,
    `/dca — DCA plans (create, list, pause, resume, cancel)`,
    `/rebalance — Portfolio rebalancing`,
    `/alerts — Price alerts & auto-trading`,
    `/schedule — Generic periodic agent jobs`,
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
  const haltBadge = result.advisoryHalt ? '🛑 HALTED' : '';

  return [
    `${icon} *Trade ${result.success ? 'Executed' : 'Failed'}* ${privacyBadge} ${haltBadge}`.trim(),
    `${result.amount} ${result.fromToken} → ${result.toToken}`,
    result.estimatedOutput ? `Est. output: ~${result.estimatedOutput}` : '',
    result.liquiditySource ? `Source: ${result.liquiditySource}` : '',
    `Strategy: ${result.strategyType} | ${result.reason}`,
    result.errorCode ? `Code: \`${result.errorCode}\`` : '',
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
  const status = target.status === 'active' ? '🟢' : target.status === 'paused' ? '🟡' : '🔴';
  const lines = [`${status} *Rebalance Target* \`${target.id}\` — ${target.chain}\n`];
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
    const icon = a.status === 'active' ? '🟢' : a.status === 'paused' ? '🟡' : '🔴';
    const dir = a.direction === 'below' ? '📉' : '📈';
    return [
      `${icon} ${dir} *${a.token}* \`${a.id}\` ${a.direction} ${a.threshold}%`,
      `Type: ${a.type} | Chain: ${a.chain}`,
      a.buyToken ? `Action: Buy ${a.buyAmount} ${a.buyToken}` : 'Alert only',
      a.referencePrice ? `Ref price: $${a.referencePrice}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

export function formatScheduledJob(job) {
  const icon = job.status === 'active' ? '🟢' : job.status === 'paused' ? '🟡' : job.status === 'completed' ? '✅' : '🔴';
  return [
    `${icon} *Scheduled Job* \`${job.id}\``,
    `Kind: ${job.kind} | ${job.scheduleKind}: \`${job.scheduleValue}\``,
    job.title ? `Title: ${job.title}` : '',
    job.prompt ? `Prompt: ${job.prompt}` : '',
    `Status: ${job.status}`,
    job.lastRunAt ? `Last run: ${job.lastRunAt}` : '',
    job.nextRunAt ? `Next run: ${job.nextRunAt}` : '',
    job.lastError ? `Last error: ${job.lastError}` : '',
  ].filter(Boolean).join('\n');
}

export function formatScheduledJobList(jobs) {
  if (!jobs.length) return 'No scheduled jobs. Create one with /schedule';
  return jobs.map(formatScheduledJob).join('\n\n');
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
  const url = signature ? `https://explorer.solana.com/tx/${signature}` : null;

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
  const url = signature ? `https://explorer.solana.com/tx/${signature}` : null;

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
    `_Settings are currently loaded from environment variables at startup._`,
    `_Modes: off (public), on (always private), auto (threshold-based)._`,
  ].filter(Boolean).join('\n');
}
