/**
 * Execution log persistence.
 * Tracks all trade executions with tx hashes, amounts, and outcomes.
 * JSON file storage at DATA_DIR/executions.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { storeLog } from '../core/logger.mjs';

let DATA_DIR;
let EXEC_PATH;
let _cache = null;

export function initExecutionsStore(dataDir) {
  DATA_DIR = dataDir;
  EXEC_PATH = join(DATA_DIR, 'executions.json');
  mkdirSync(DATA_DIR, { recursive: true });
  _cache = null;
}

function load() {
  if (_cache) return _cache;
  if (!existsSync(EXEC_PATH)) {
    _cache = [];
    return _cache;
  }
  try {
    _cache = JSON.parse(readFileSync(EXEC_PATH, 'utf-8'));
    return _cache;
  } catch (err) {
    storeLog.warn({ err }, 'Failed to read executions, starting fresh');
    _cache = [];
    return _cache;
  }
}

function save() {
  writeFileSync(EXEC_PATH, JSON.stringify(_cache, null, 2) + '\n');
}

export function logExecution(result) {
  const data = load();
  data.push(result);
  // Keep last 1000 executions
  if (data.length > 1000) {
    _cache = data.slice(-1000);
  }
  save();
  storeLog.info({
    execId: result.id,
    success: result.success,
    txHash: result.txHash,
  }, 'Execution logged');
  return result;
}

export function getExecutions({ chatId, strategyId, strategyType, limit = 20 } = {}) {
  let data = load();
  if (strategyId) data = data.filter(e => e.strategyId === strategyId);
  if (strategyType) data = data.filter(e => e.strategyType === strategyType);
  return data.slice(-limit).reverse();
}

export function getRecentExecutions(limit = 10) {
  return load().slice(-limit).reverse();
}

export function getExecutionsByStrategy(strategyId, limit = 50) {
  return load()
    .filter(e => e.strategyId === strategyId)
    .slice(-limit)
    .reverse();
}

export function getExecutionStats() {
  const data = load();
  const total = data.length;
  const successful = data.filter(e => e.success).length;
  const failed = total - successful;
  const last24h = data.filter(
    e => new Date(e.timestamp) > new Date(Date.now() - 86_400_000)
  );
  return {
    total,
    successful,
    failed,
    last24h: last24h.length,
    successRate: total > 0 ? ((successful / total) * 100).toFixed(1) + '%' : 'N/A',
  };
}

export function invalidateCache() {
  _cache = null;
}
