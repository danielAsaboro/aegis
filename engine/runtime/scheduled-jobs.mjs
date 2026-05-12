/**
 * Persisted scheduled agent jobs.
 */

import { getPrisma } from '../db/index.mjs';

function parseJson(raw, fallback = null) {
  if (raw == null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function rowToJob(row) {
  return {
    id: row.id,
    kind: row.kind,
    scheduleKind: row.scheduleKind,
    scheduleValue: row.scheduleValue,
    userId: row.userId,
    chatId: row.chatId,
    prompt: row.prompt,
    payload: parseJson(row.payloadJson, {}),
    status: row.status,
    title: row.title,
    lastRunAt: row.lastRunAt?.toISOString?.() ?? row.lastRunAt,
    nextRunAt: row.nextRunAt?.toISOString?.() ?? row.nextRunAt,
    lastError: row.lastError,
    createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
    updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt,
  };
}

export async function createScheduledJob({
  kind = 'agent_turn',
  scheduleKind = 'cron',
  scheduleValue,
  userId,
  chatId,
  prompt,
  payload,
  status = 'active',
  title,
  nextRunAt,
} = {}) {
  const row = await getPrisma().scheduledJob.create({
    data: {
      kind,
      scheduleKind,
      scheduleValue: String(scheduleValue),
      userId: String(userId),
      chatId: chatId != null ? String(chatId) : null,
      prompt: prompt || null,
      payloadJson: payload == null ? null : JSON.stringify(payload),
      status,
      title: title || null,
      nextRunAt: nextRunAt ? new Date(nextRunAt) : null,
    },
  });
  return rowToJob(row);
}

export async function listScheduledJobs({ status, kind } = {}) {
  const where = {};
  if (status) where.status = status;
  if (kind) where.kind = kind;
  const rows = await getPrisma().scheduledJob.findMany({
    where,
    orderBy: [{ createdAt: 'asc' }],
  });
  return rows.map(rowToJob);
}

export async function listActiveScheduledJobs() {
  return listScheduledJobs({ status: 'active' });
}

export async function updateScheduledJob(jobId, updates = {}) {
  const data = {};
  if (updates.status !== undefined) data.status = updates.status;
  if (updates.prompt !== undefined) data.prompt = updates.prompt;
  if (updates.payload !== undefined) data.payloadJson = updates.payload == null ? null : JSON.stringify(updates.payload);
  if (updates.lastRunAt !== undefined) data.lastRunAt = updates.lastRunAt ? new Date(updates.lastRunAt) : null;
  if (updates.nextRunAt !== undefined) data.nextRunAt = updates.nextRunAt ? new Date(updates.nextRunAt) : null;
  if (updates.lastError !== undefined) data.lastError = updates.lastError;
  const row = await getPrisma().scheduledJob.update({ where: { id: jobId }, data });
  return rowToJob(row);
}

export async function recordScheduledJobRun(jobId, { nextRunAt = null, error = null, status } = {}) {
  return updateScheduledJob(jobId, {
    lastRunAt: new Date().toISOString(),
    nextRunAt,
    lastError: error ? String(error) : null,
    status: status || undefined,
  });
}
