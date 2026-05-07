/**
 * Trade execution log — Prisma-backed.
 *
 * Replaces the JSON file at ~/.zerion/aegis/executions.json. All exports
 * are async; callers must await every read and write.
 */

import { getPrisma, closeDb, initDb, pushDbSchema } from '../db/index.mjs';
import { storeLog } from '../core/logger.mjs';
import { join } from 'node:path';

function rowToExecution(row) {
  return {
    id: row.id,
    proposalId: row.proposalId,
    strategyId: row.strategyId,
    strategyType: row.strategyType,
    fromToken: row.fromToken,
    toToken: row.toToken,
    amount: row.amount,
    chain: row.chain,
    reason: row.reason,
    success: row.success,
    txHash: row.txHash,
    error: row.errorMsg,
    estimatedOutput: row.estimatedOutput,
    liquiditySource: row.liquiditySource,
    private: row.isPrivate,
    shieldedBalance: row.shieldedBalance,
    chatId: row.chatId,
    missionId: row.missionId,
    amountUsd: row.amountUsd,
    timestamp: row.createdAt?.toISOString?.() ?? row.createdAt,
  };
}

export async function logExecution(result) {
  await getPrisma().tradeExecution.create({
    data: {
      id: result.id,
      proposalId: result.proposalId || '',
      strategyId: result.strategyId || '',
      strategyType: result.strategyType || 'manual',
      fromToken: result.fromToken,
      toToken: result.toToken,
      amount: String(result.amount),
      chain: result.chain,
      reason: result.reason || '',
      success: !!result.success,
      txHash: result.txHash || null,
      errorMsg: result.error || null,
      estimatedOutput: result.estimatedOutput != null ? String(result.estimatedOutput) : null,
      liquiditySource: result.liquiditySource || null,
      isPrivate: !!result.private,
      shieldedBalance: result.shieldedBalance != null ? String(result.shieldedBalance) : null,
      chatId: result.chatId != null ? String(result.chatId) : null,
      missionId: result.missionId || null,
      amountUsd: result.amountUsd != null ? Number(result.amountUsd) : null,
    },
  });
  storeLog.info({
    execId: result.id,
    success: result.success,
    txHash: result.txHash,
  }, 'Execution logged');
  return result;
}

export async function getExecutions({ chatId, strategyId, strategyType, limit = 20 } = {}) {
  const where = {};
  if (chatId != null) where.chatId = String(chatId);
  if (strategyId) where.strategyId = strategyId;
  if (strategyType) where.strategyType = strategyType;
  const rows = await getPrisma().tradeExecution.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map(rowToExecution);
}

export async function getRecentExecutions(limit = 10) {
  const rows = await getPrisma().tradeExecution.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map(rowToExecution);
}

export async function getExecutionsByStrategy(strategyId, limit = 50) {
  const rows = await getPrisma().tradeExecution.findMany({
    where: { strategyId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map(rowToExecution);
}

export async function getExecutionStats() {
  const prisma = getPrisma();
  const since24h = new Date(Date.now() - 86_400_000);
  const [total, successful, last24h] = await Promise.all([
    prisma.tradeExecution.count(),
    prisma.tradeExecution.count({ where: { success: true } }),
    prisma.tradeExecution.count({ where: { createdAt: { gt: since24h } } }),
  ]);
  const failed = total - successful;
  return {
    total,
    successful,
    failed,
    last24h,
    successRate: total > 0 ? ((successful / total) * 100).toFixed(1) + '%' : 'N/A',
  };
}

export async function initExecutionsStore(testDir) {
  process.env.DATA_DIR = testDir;
  process.env.AEGIS_DATABASE_URL = `file:${join(testDir, 'aegis.db')}`;
  pushDbSchema();
  await closeDb();
  await initDb();
}
