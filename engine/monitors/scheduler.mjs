/**
 * Schedule Monitor — cron-based timer for DCA ticks.
 *
 * Each active DCA plan gets its own cron job.
 * When a job fires, it emits a DCA_TICK signal on the event bus.
 */

import cron from 'node-cron';
import bus from '../core/event-bus.mjs';
import { SignalType } from '../core/types.mjs';
import { monitorLog } from '../core/logger.mjs';
import { getActiveDCAPlans } from '../store/plans.mjs';

const _jobs = new Map(); // planId → cron.ScheduledTask

/**
 * Start the scheduler — creates cron jobs for all active DCA plans.
 */
export function startScheduler() {
  monitorLog.info('Starting DCA scheduler');
  // syncJobs is async but we don't block startup on it.
  Promise.resolve(syncJobs()).catch(err => monitorLog.warn({ err: err.message }, 'syncJobs initial run failed'));
  return () => stopScheduler();
}

/**
 * Sync cron jobs with current active DCA plans.
 * Call this after creating/pausing/cancelling plans.
 */
export async function syncJobs() {
  const plans = await getActiveDCAPlans();
  const activePlanIds = new Set(plans.map(p => p.id));

  // Remove jobs for plans that are no longer active
  for (const [planId, job] of _jobs) {
    if (!activePlanIds.has(planId)) {
      job.stop();
      _jobs.delete(planId);
      monitorLog.info({ planId }, 'Removed DCA cron job');
    }
  }

  // Add jobs for new active plans
  for (const plan of plans) {
    if (!_jobs.has(plan.id)) {
      schedulePlan(plan);
    }
  }

  monitorLog.info({ activeJobs: _jobs.size }, 'DCA scheduler synced');
}

function schedulePlan(plan) {
  const cronExpr = plan.cron || '*/5 * * * *'; // default: every 5 minutes

  if (!cron.validate(cronExpr)) {
    monitorLog.error({ planId: plan.id, cron: cronExpr }, 'Invalid cron expression');
    return;
  }

  const job = cron.schedule(cronExpr, () => {
    const isPrivate = plan.forcePrivate || false;
    monitorLog.info({
      planId: plan.id,
      token: plan.toToken,
      amount: plan.amount,
      private: isPrivate,
    }, 'DCA tick');

    bus.signal(SignalType.DCA_TICK, {
      planId: plan.id,
      fromToken: plan.fromToken,
      toToken: plan.toToken,
      amount: plan.amount,
      chain: plan.chain,
      chatId: plan.chatId,
      policies: plan.policies,
      forcePrivate: isPrivate,
    });
  });

  _jobs.set(plan.id, job);
  monitorLog.info({ planId: plan.id, cron: cronExpr }, 'DCA cron job scheduled');
}

/**
 * Stop all cron jobs.
 */
export function stopScheduler() {
  for (const [planId, job] of _jobs) {
    job.stop();
  }
  _jobs.clear();
  monitorLog.info('DCA scheduler stopped');
}

/**
 * Get status of all scheduled jobs.
 */
export function getSchedulerStatus() {
  return {
    activeJobs: _jobs.size,
    jobs: Array.from(_jobs.keys()),
  };
}
