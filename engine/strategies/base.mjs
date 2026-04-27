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

      strategyLog.info({
        strategy: this.id,
        proposalId: proposal.id,
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
    } catch (err) {
      strategyLog.error({ strategy: this.id, err: err.message }, 'Strategy error');
    }
  }
}
