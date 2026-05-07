/**
 * BaseStrategy — common interface for all AEGIS strategies.
 *
 * Every strategy:
 * 1. Subscribes to specific signal types on the event bus
 * 2. On signal, evaluates whether to act
 * 3. If yes, creates a TradeProposal
 * 4. Sends proposal through the policy engine
 * 5. If approved, passes to execution engine
 */

import bus from '../core/event-bus.mjs';
import { runPolicies } from '../policies/engine.mjs';
import { executeTrade, getTxExplorerUrl } from '../execution/executor.mjs';
import { strategyLog } from '../core/logger.mjs';
import {
  findActiveMissionForCall,
  recordMissionTick,
  recordMissionDenial,
} from '../missions/index.mjs';
import { notify } from '../notify/index.mjs';

const KIND_BY_STRATEGY_ID = {
  dca: 'dca',
  'dip-buyer': 'dip',
  'take-profit': 'dip',
  rebalancer: 'rebalance',
  group: 'group',
  agent: 'agent',
};

export class BaseStrategy {
  /**
   * @param {object} opts
   * @param {string} opts.id - Strategy type identifier
   * @param {string} opts.name - Human-readable name
   * @param {string[]} opts.signals - Signal types this strategy subscribes to
   * @param {string} opts.walletName - OWS wallet name for execution
   */
  constructor({ id, name, signals, walletName }) {
    this.id = id;
    this.name = name;
    this.signals = signals;
    this.walletName = walletName;
    this._unsubscribers = [];
    this._notifyFn = null;
  }

  /**
   * Register the strategy on the event bus.
   */
  start() {
    for (const signalType of this.signals) {
      const unsub = bus.subscribe(signalType, (signal) => this._handleSignal(signal));
      this._unsubscribers.push(unsub);
    }
    strategyLog.info({ strategy: this.id, signals: this.signals }, 'Strategy started');
  }

  /**
   * Unsubscribe from all signals.
   */
  stop() {
    for (const unsub of this._unsubscribers) {
      unsub();
    }
    this._unsubscribers = [];
    strategyLog.info({ strategy: this.id }, 'Strategy stopped');
  }

  /**
   * Set a notification callback (e.g., Telegram message sender).
   */
  onNotify(fn) {
    this._notifyFn = fn;
  }

  /**
   * Handle an incoming signal — subclasses override this.
   * Should return a TradeProposal or null.
   */
  async evaluate(signal) {
    throw new Error('Subclass must implement evaluate()');
  }

  /**
   * Internal signal handler — orchestrates evaluate → policy → execute.
   */
  async _handleSignal(signal) {
    try {
      const proposal = await this.evaluate(signal);
      if (!proposal) return;

      // Try to link this proposal to an active Mission for the chat,
      // matching by kind. Strategies that don't have a chatId (e.g. cron
      // ticks) still resolve missions by signal context if available.
      const missionKind = KIND_BY_STRATEGY_ID[this.id] || null;
      let mission = null;
      if (missionKind) {
        const userId = signal?.userId || proposal?.signal?.userId;
        const chatId = signal?.chatId || proposal?.signal?.chatId;
        try {
          mission = await findActiveMissionForCall({ userId, chatId, kind: missionKind });
        } catch { /* ignore mission lookup failures */ }
        if (mission) {
          proposal.missionId = mission.id;
          if (mission.policies && Object.keys(mission.policies).length > 0) {
            proposal.policies = mission.policies;
          }
          await recordMissionTick({ missionId: mission.id, signal });
        }
      }

      strategyLog.info({
        strategy: this.id,
        proposalId: proposal.id,
        missionId: proposal.missionId || null,
        trade: `${proposal.amount} ${proposal.fromToken} → ${proposal.toToken}`,
      }, 'Trade proposed');

      // Run policies
      const policyResult = await runPolicies(proposal, proposal.policies);

      if (!policyResult.approved) {
        strategyLog.info({
          strategy: this.id,
          proposalId: proposal.id,
          deniedBy: policyResult.deniedBy,
          reason: policyResult.reason,
        }, 'Trade denied by policy');

        if (proposal.missionId) {
          try {
            await recordMissionDenial({
              missionId: proposal.missionId,
              deniedBy: policyResult.deniedBy,
              reason: policyResult.reason,
            });
            await notify({
              level: 'warn',
              title: `Mission tick skipped (${policyResult.deniedBy})`,
              body: policyResult.reason,
              missionId: proposal.missionId,
            });
          } catch { /* non-fatal */ }
        }

        if (this._notifyFn) {
          this._notifyFn({
            type: 'denied',
            proposal,
            deniedBy: policyResult.deniedBy,
            reason: policyResult.reason,
          });
        }
        return;
      }

      // Attach approved policyResult — the executor refuses ungated trades.
      proposal.policyResult = policyResult;

      // Execute
      const result = await executeTrade(proposal, { walletName: this.walletName });

      if (this._notifyFn) {
        this._notifyFn({
          type: result.success ? 'executed' : 'failed',
          proposal,
          result,
          explorerUrl: getTxExplorerUrl(result.txHash, proposal.chain),
        });
      }

      if (proposal.missionId) {
        try {
          await notify({
            level: 'info',
            title: result.success
              ? `Mission tick executed`
              : `Mission tick failed`,
            body: `${proposal.amount} ${proposal.fromToken} → ${proposal.toToken}` + (result.txHash ? ` · ${result.txHash}` : ''),
            missionId: proposal.missionId,
            payload: { txHash: result.txHash, error: result.error },
          });
        } catch { /* non-fatal */ }
      }
    } catch (err) {
      strategyLog.error({ strategy: this.id, err: err.message }, 'Strategy error');
    }
  }
}
