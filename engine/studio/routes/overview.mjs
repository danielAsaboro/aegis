/**
 * GET /api/overview — engine top-of-page snapshot.
 * Returns counters, last events, active strategy/monitor counts.
 */

import bus from '../../core/event-bus.mjs';
import { getPrisma } from '../../db/index.mjs';
import { getAllStrategies } from '../../strategies/index.mjs';
import { getRecentSignals } from '../ws/signals.mjs';

const BOOT_AT = Date.now();

export async function registerOverviewRoutes(app) {
  app.get('/api/overview', async () => {
    const prisma = getPrisma();
    const [
      activeDcaPlans,
      activeRebalanceTargets,
      activePriceAlerts,
      tradesToday,
      invocationsToday,
      latestTrade,
    ] = await Promise.all([
      prisma.dCAPlan.count({ where: { status: 'active' } }),
      prisma.rebalanceTarget.count({ where: { status: 'active' } }),
      prisma.priceAlert.count({ where: { status: 'active' } }),
      prisma.tradeExecution.count({ where: { createdAt: { gte: startOfToday() } } }),
      prisma.agentInvocation.count({ where: { startedAt: { gte: startOfToday() } } }),
      prisma.tradeExecution.findFirst({ orderBy: { createdAt: 'desc' } }),
    ]);

    return {
      engine: {
        bootAt: new Date(BOOT_AT).toISOString(),
        uptimeMs: Date.now() - BOOT_AT,
        nodeVersion: process.version,
        pid: process.pid,
      },
      strategies: getAllStrategies().map((s) => ({
        id: s.id,
        name: s.name,
        signals: s.signals,
      })),
      signals: bus.getStats(),
      recentSignals: getRecentSignals(10),
      counts: {
        activeDcaPlans,
        activeRebalanceTargets,
        activePriceAlerts,
        tradesToday,
        invocationsToday,
      },
      latestTrade,
    };
  });

  app.get('/api/health', async () => ({ ok: true, ts: Date.now() }));
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
