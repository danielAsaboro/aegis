/**
 * AgentStrategy — autonomous LLM-driven reactions to signals.
 *
 * Subscribes to PRICE_DIP, PRICE_SPIKE, WHALE_BUY, WHALE_SELL. For each
 * signal it asks a single-shot structured-output verdict generator (no
 * tools, low tokens) for a machine-readable decision. From there:
 *
 *   - hold/skip            → notify the user with the verdict's reason; stop.
 *   - act, autonomous,
 *     sizeUsd ≤ cap        → build a TradeProposal directly, run policies,
 *                            execute on approval. No LLM tool loop.
 *   - act, advisory or
 *     sizeUsd > cap        → forward the verdict to the existing tool-loop
 *                            agent so the chat surface drives approval.
 *
 * Cost guards:
 *   - AEGIS_AGENT_AUTONOMY = off  → strategy is inert.
 *   - Per-signal-type cooldown via AEGIS_AGENT_SIGNAL_COOLDOWN_MS.
 *   - Per-strategy hourly invocation budget shared with chat surfaces.
 *
 * The auto-execute branch still goes through `runPolicies(...)`. Spend-limit,
 * cooldown, time-window etc. remain authoritative — the structured verdict
 * is a recommendation, the policy engine is the gate.
 */

import { BaseStrategy } from './base.mjs';
import { SignalType, createTradeProposal } from '../core/types.mjs';
import { strategyLog } from '../core/logger.mjs';
import { runAgentTurn as defaultRunAgentTurn } from '../agent/index.mjs';
import { withinBudget as defaultWithinBudget, recordInvocation as defaultRecordInvocation } from '../agent/db-budget.mjs';
import { runPolicies as defaultRunPolicies, getDefaultPolicies } from '../policies/engine.mjs';
import { executeTrade as defaultExecuteTrade, getTxExplorerUrl } from '../execution/executor.mjs';
import {
  decideOnPriceMove as defaultDecideOnPriceMove,
  decideOnWhaleMove as defaultDecideOnWhaleMove,
} from '../agent/structured-decision.mjs';
import env from '../config.mjs';

const SUBSCRIBED = [
  SignalType.PRICE_DIP,
  SignalType.PRICE_SPIKE,
  SignalType.WHALE_BUY,
  SignalType.WHALE_SELL,
];

function isPriceSignal(type) {
  return type === SignalType.PRICE_DIP || type === SignalType.PRICE_SPIKE;
}

function defaultLegsForPriceSignal(signal, action) {
  const token = signal.token;
  if (action === 'buy') return { fromToken: 'USDC', toToken: token };
  if (action === 'sell') return { fromToken: token, toToken: 'USDC' };
  return {};
}

function defaultLegsForWhaleSignal(signal, decision) {
  const token = signal.token;
  if (decision === 'mirror') {
    return signal.type === SignalType.WHALE_BUY
      ? { fromToken: 'USDC', toToken: token }
      : { fromToken: token, toToken: 'USDC' };
  }
  if (decision === 'fade') {
    return signal.type === SignalType.WHALE_BUY
      ? { fromToken: token, toToken: 'USDC' }
      : { fromToken: 'USDC', toToken: token };
  }
  return {};
}

export class AgentStrategy extends BaseStrategy {
  constructor({ walletName, notifyChatId, deps } = {}) {
    super({
      id: 'agent',
      name: 'LLM Agent (autonomous)',
      signals: SUBSCRIBED,
      walletName,
    });
    this._lastFiredByType = new Map(); // signalType → ms
    this._notifyChatId = notifyChatId || null;
    // Test-only seam: callers may inject stubs for the LLM, policy, and
    // execution boundaries. Production callers leave `deps` undefined.
    this._deps = {
      decideOnPriceMove: deps?.decideOnPriceMove || defaultDecideOnPriceMove,
      decideOnWhaleMove: deps?.decideOnWhaleMove || defaultDecideOnWhaleMove,
      runPolicies: deps?.runPolicies || defaultRunPolicies,
      executeTrade: deps?.executeTrade || defaultExecuteTrade,
      runAgentTurn: deps?.runAgentTurn || defaultRunAgentTurn,
      withinBudget: deps?.withinBudget || defaultWithinBudget,
      recordInvocation: deps?.recordInvocation || defaultRecordInvocation,
      getAutonomy: deps?.getAutonomy || (() => env.AEGIS_AGENT_AUTONOMY),
      getMaxAutoExecuteUsd: deps?.getMaxAutoExecuteUsd || (() => env.AEGIS_AUTO_EXECUTE_MAX_USD),
      getCooldownMs: deps?.getCooldownMs || (() => env.AEGIS_AGENT_SIGNAL_COOLDOWN_MS),
    };
  }

  /**
   * Override BaseStrategy._handleSignal — verdict-first, then either
   * auto-execute under the size cap or hand off to the tool-loop agent.
   */
  async _handleSignal(signal) {
    const autonomy = this._deps.getAutonomy();
    if (autonomy === 'off') return;

    const now = Date.now();
    const cooldown = this._deps.getCooldownMs();
    const last = this._lastFiredByType.get(signal.type) || 0;
    if (now - last < cooldown) {
      strategyLog.debug({ type: signal.type, sinceLast: now - last }, 'AgentStrategy cooldown — skipping');
      return;
    }

    const budgetKey = `system:agent:${signal.type}`;
    if (!(await this._deps.withinBudget(budgetKey))) {
      strategyLog.warn({ type: signal.type, key: budgetKey }, 'AgentStrategy budget exhausted — skipping');
      return;
    }

    this._lastFiredByType.set(signal.type, now);
    await this._deps.recordInvocation(budgetKey);

    let verdict;
    try {
      verdict = isPriceSignal(signal.type)
        ? await this._deps.decideOnPriceMove(signal)
        : await this._deps.decideOnWhaleMove(signal);
    } catch (err) {
      strategyLog.error({ err: err.message, type: signal.type }, 'verdict generation crashed');
      return;
    }

    const action = isPriceSignal(signal.type) ? verdict.action : verdict.decision;
    strategyLog.info(
      { type: signal.type, autonomy, action, sizeUsd: verdict.sizeUsd, confidence: verdict.confidence },
      'AgentStrategy verdict received'
    );

    // hold / skip: notify and stop. No further LLM tokens, no policy run.
    if (action === 'hold' || action === 'skip') {
      if (this._notifyFn) {
        this._notifyFn({
          type: 'agent_signal',
          signal,
          text: `(${signal.type}) ${verdict.reason || 'hold'}`,
          verdict,
          chatId: this._notifyChatId,
        });
      }
      return;
    }

    const cap = this._deps.getMaxAutoExecuteUsd();
    const wantsAct = !!verdict.sizeUsd;
    const underCap = wantsAct && verdict.sizeUsd <= cap;

    if (autonomy === 'autonomous' && underCap) {
      await this._autoExecute(signal, verdict);
      return;
    }

    // Advisory path (or autonomous + over-cap): hand off to the tool-loop
    // agent with a tightly-scoped prompt derived from the verdict so the
    // chat surface's approval flow takes over.
    await this._advisoryHandoff(signal, verdict, budgetKey);
  }

  async _autoExecute(signal, verdict) {
    const action = isPriceSignal(signal.type) ? verdict.action : verdict.decision;
    const defaults = isPriceSignal(signal.type)
      ? defaultLegsForPriceSignal(signal, action)
      : defaultLegsForWhaleSignal(signal, action);
    const legs = {
      fromToken: verdict.fromToken || defaults.fromToken,
      toToken: verdict.toToken || defaults.toToken,
    };

    // The verdict's sizeUsd is in USD. The trade proposal expects an amount
    // in fromToken units. For the supported case of stable→token / token→
    // stable, we pass sizeUsd as the from-token amount when the from-token
    // is USDC. For non-USDC legs we let the policy layer + chat advisory
    // surface handle it; we don't auto-execute non-USDC legs.
    const fromToken = (legs.fromToken || '').toUpperCase();
    const toToken = (legs.toToken || '').toUpperCase();
    if (!fromToken || !toToken) {
      strategyLog.warn({ verdict }, 'auto-execute skipped: no token legs in verdict');
      return this._advisoryHandoff(signal, verdict, `system:agent:${signal.type}`);
    }
    if (fromToken !== 'USDC') {
      strategyLog.info({ fromToken, toToken }, 'auto-execute skipped: from-token is not USDC; falling back to advisory');
      return this._advisoryHandoff(signal, verdict, `system:agent:${signal.type}`);
    }

    const proposal = createTradeProposal({
      strategyId: this.id,
      strategyType: 'manual',
      fromToken,
      toToken,
      amount: String(verdict.sizeUsd),
      chain: signal.chain || env.DEFAULT_CHAIN,
      reason: `auto-execute ${signal.type}: ${verdict.reason || ''}`.slice(0, 280),
      signal,
      policies: getDefaultPolicies('manual'),
    });

    let policyResult;
    try {
      policyResult = await this._deps.runPolicies(proposal, proposal.policies);
    } catch (err) {
      strategyLog.error({ err: err.message, proposalId: proposal.id }, 'auto-execute policy run failed');
      if (this._notifyFn) {
        this._notifyFn({
          type: 'denied',
          proposal,
          deniedBy: 'policy-engine',
          reason: err.message,
          chatId: this._notifyChatId,
        });
      }
      return;
    }

    if (!policyResult.approved) {
      strategyLog.info(
        { proposalId: proposal.id, deniedBy: policyResult.deniedBy, reason: policyResult.reason },
        'auto-execute denied by policy'
      );
      if (this._notifyFn) {
        this._notifyFn({
          type: 'denied',
          proposal,
          deniedBy: policyResult.deniedBy,
          reason: policyResult.reason,
          chatId: this._notifyChatId,
        });
      }
      return;
    }

    proposal.policyResult = policyResult;

    let result;
    try {
      result = await this._deps.executeTrade(proposal, { walletName: this.walletName });
    } catch (err) {
      strategyLog.error({ err: err.message, proposalId: proposal.id }, 'auto-execute failed');
      if (this._notifyFn) {
        this._notifyFn({
          type: 'failed',
          proposal,
          result: { success: false, error: err.message },
          chatId: this._notifyChatId,
        });
      }
      return;
    }

    if (this._notifyFn) {
      this._notifyFn({
        type: result.success ? 'executed' : 'failed',
        proposal,
        result,
        explorerUrl: getTxExplorerUrl(result.txHash, proposal.chain),
        verdict,
        chatId: this._notifyChatId,
      });
    }
  }

  async _advisoryHandoff(signal, verdict, budgetKey) {
    const action = isPriceSignal(signal.type) ? verdict.action : verdict.decision;
    const legs = [verdict.fromToken, verdict.toToken].filter(Boolean).join(' → ');
    const sizePart = verdict.sizeUsd ? ` ~$${verdict.sizeUsd}` : '';
    const prompt = [
      `Signal ${signal.type} (${signal.token || ''}): verdict=${action}${sizePart}, confidence=${verdict.confidence}.`,
      `Reason: ${verdict.reason || '(none)'}.`,
      legs ? `Suggested legs: ${legs}.` : '',
      `Use executeSwap to act, or reply briefly explaining why not. Defer trade size to spend-limit policy if needed.`,
    ].filter(Boolean).join(' ');

    try {
      const result = await this._deps.runAgentTurn({
        prompt,
        userId: budgetKey,
        chatId: this._notifyChatId,
        source: 'signal',
        walletName: this.walletName,
        skipBudget: true,
      });

      if (this._notifyFn && result?.text) {
        this._notifyFn({
          type: 'agent_signal',
          signal,
          text: result.text,
          toolCalls: result.toolCalls || [],
          verdict,
          chatId: this._notifyChatId,
        });
      }
    } catch (err) {
      strategyLog.error({ err: err.message, type: signal.type }, 'AgentStrategy advisory handoff failed');
    }
  }
}
