/**
 * Schedule monitor.
 *
 * Deterministic DCA jobs still emit DCA_TICK on the event bus. Scheduled
 * agent jobs enqueue a message into the shared runtime instead of bypassing
 * the agent loop.
 */

import cron from 'node-cron';
import bus from '../core/event-bus.mjs';
import { SignalType } from '../core/types.mjs';
import { monitorLog } from '../core/logger.mjs';
import { getActiveDCAPlans } from '../store/plans.mjs';
import { listActiveScheduledJobs, recordScheduledJobRun } from '../runtime/scheduled-jobs.mjs';

const _jobs = new Map(); // key → handle
let _runtime = null;

/**
 * Start the scheduler — creates cron jobs for all active DCA plans.
 */
export function startScheduler({ messageRuntime } = {}) {
  monitorLog.info('Starting DCA scheduler');
  _runtime = messageRuntime || null;
  // syncJobs is async but we don't block startup on it.
  Promise.resolve(syncJobs({ messageRuntime: _runtime })).catch(err => monitorLog.warn({ err: err.message }, 'syncJobs initial run failed'));
  return () => stopScheduler();
}

/**
 * Sync cron jobs with current active DCA plans.
 * Call this after creating/pausing/cancelling plans.
 */
export async function syncJobs({ messageRuntime } = {}) {
  if (messageRuntime) _runtime = messageRuntime;
  const plans = await getActiveDCAPlans();
  const scheduledJobs = await listActiveScheduledJobs();
  const activePlanIds = new Set(plans.map(p => p.id));
  const activeScheduledIds = new Set(scheduledJobs.map((job) => `scheduled:${job.id}`));
  const desired = new Set([...plans.map((p) => `dca:${p.id}`), ...activeScheduledIds]);

  // Remove jobs for plans that are no longer active
  for (const [key, job] of _jobs) {
    if (!desired.has(key)) {
      stopHandle(job);
      _jobs.delete(key);
      monitorLog.info({ key }, 'Removed scheduler job');
    }
  }

  // Add jobs for new active plans
  for (const plan of plans) {
    const key = `dca:${plan.id}`;
    if (!_jobs.has(key)) {
      schedulePlan(plan);
    }
  }

  for (const job of scheduledJobs) {
    const key = `scheduled:${job.id}`;
    if (!_jobs.has(key)) scheduleAgentJob(job);
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

  _jobs.set(`dca:${plan.id}`, job);
  monitorLog.info({ planId: plan.id, cron: cronExpr }, 'DCA cron job scheduled');
}

function stopHandle(handle) {
  if (!handle) return;
  if (typeof handle.stop === 'function') handle.stop();
  if (handle.kind === 'interval') clearInterval(handle.id);
  if (handle.kind === 'timeout') clearTimeout(handle.id);
}

async function fireAgentJob(job) {
  if (!_runtime) {
    monitorLog.warn({ jobId: job.id }, 'scheduled agent job skipped: no message runtime attached');
    return;
  }

  try {
    await _runtime.enqueueMessage({
      userId: job.userId,
      chatId: job.chatId,
      source: 'scheduled',
      turnProfile: 'scheduled',
      prompt: job.prompt,
      delivery: job.chatId ? { type: 'telegram', chatId: job.chatId } : { type: 'notification', jobId: job.id },
      metadata: { scheduledJobId: job.id, title: job.title, scheduleKind: job.scheduleKind },
    });
    await recordScheduledJobRun(job.id);
  } catch (err) {
    await recordScheduledJobRun(job.id, { error: err.message });
    monitorLog.warn({ jobId: job.id, err: err.message }, 'scheduled agent job failed');
  }
}

function scheduleAgentJob(job) {
  const key = `scheduled:${job.id}`;
  let handle = null;

  if (job.scheduleKind === 'cron') {
    if (!cron.validate(job.scheduleValue)) {
      monitorLog.error({ jobId: job.id, scheduleValue: job.scheduleValue }, 'Invalid agent cron expression');
      return;
    }
    handle = cron.schedule(job.scheduleValue, () => { void fireAgentJob(job); });
  } else if (job.scheduleKind === 'every') {
    const ms = Number(job.scheduleValue);
    if (!Number.isFinite(ms) || ms <= 0) {
      monitorLog.error({ jobId: job.id, scheduleValue: job.scheduleValue }, 'Invalid agent interval');
      return;
    }
    handle = { kind: 'interval', id: setInterval(() => { void fireAgentJob(job); }, ms) };
  } else if (job.scheduleKind === 'at') {
    const target = new Date(job.scheduleValue);
    const delay = target.getTime() - Date.now();
    if (!Number.isFinite(delay) || delay <= 0) {
      monitorLog.warn({ jobId: job.id, scheduleValue: job.scheduleValue }, 'Skipping expired one-shot agent job');
      return;
    }
    handle = {
      kind: 'timeout',
      id: setTimeout(async () => {
        await fireAgentJob(job);
        _jobs.delete(key);
        try { await recordScheduledJobRun(job.id, { status: 'completed' }); } catch { /* ignore */ }
      }, delay),
    };
  } else {
    monitorLog.warn({ jobId: job.id, scheduleKind: job.scheduleKind }, 'Unknown scheduled job type');
    return;
  }

  _jobs.set(key, handle);
  monitorLog.info({ jobId: job.id, scheduleKind: job.scheduleKind, scheduleValue: job.scheduleValue }, 'Scheduled agent job registered');
}

/**
 * Stop all cron jobs.
 */
export function stopScheduler() {
  for (const [, job] of _jobs) {
    stopHandle(job);
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
    jobs: Array.from(_jobs.keys()).map((key) => key.replace(/^[^:]+:/, '')),
  };
}
