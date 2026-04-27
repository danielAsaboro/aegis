/**
 * /status — Portfolio overview + all active strategies + next executions.
 */

import { getPortfolioAllocations, getPortfolioValue } from '../../utils/zerion-api.mjs';
import { getEvmAddress, getSolAddress } from '../../../cli/lib/wallet/keystore.js';
import { isSolana } from '../../../cli/lib/chain/registry.js';
import { getActiveDCAPlans } from '../../store/plans.mjs';
import { getActiveRebalanceTargets, getActivePriceAlerts } from '../../store/plans.mjs';
import { getExecutionStats } from '../../store/executions.mjs';
import { getSchedulerStatus } from '../../monitors/scheduler.mjs';
import { formatPortfolio } from '../formatters.mjs';
import bus from '../../core/event-bus.mjs';

export function registerStatus(bot, config) {
  bot.command('status', async (ctx) => {
    try {
      const chain = config.defaultChain;
      const walletAddress = isSolana(chain)
        ? getSolAddress(config.walletName)
        : getEvmAddress(config.walletName);

      // Fetch portfolio
      let portfolioMsg = '';
      try {
        const [positions, { totalValue }] = await Promise.all([
          getPortfolioAllocations(walletAddress, chain),
          getPortfolioValue(walletAddress),
        ]);
        portfolioMsg = formatPortfolio(positions, totalValue);
      } catch (err) {
        portfolioMsg = `Portfolio: Error fetching (${err.message})`;
      }

      // Active strategies
      const dcaPlans = getActiveDCAPlans();
      const rebalTargets = getActiveRebalanceTargets();
      const alerts = getActivePriceAlerts();
      const scheduler = getSchedulerStatus();
      const execStats = getExecutionStats();
      const signalStats = bus.getStats();
      const activeSignals = Object.entries(signalStats).filter(([, v]) => v > 0);

      const lines = [
        portfolioMsg,
        '',
        '*Active Strategies*',
        `DCA Plans: ${dcaPlans.length} active (${scheduler.activeJobs} cron jobs)`,
        `Rebalance Targets: ${rebalTargets.length}`,
        `Price Alerts: ${alerts.length}`,
        '',
        '*Execution Stats*',
        `Total: ${execStats.total} | Success: ${execStats.successful} | Failed: ${execStats.failed}`,
        `Last 24h: ${execStats.last24h} | Rate: ${execStats.successRate}`,
        '',
        activeSignals.length > 0
          ? `*Signals Processed:* ${activeSignals.map(([k, v]) => `${k}: ${v}`).join(', ')}`
          : '*Signals:* Waiting for first signal...',
      ];

      await ctx.replyWithMarkdown(lines.join('\n'));
    } catch (err) {
      await ctx.reply(`Status error: ${err.message}`);
    }
  });
}
