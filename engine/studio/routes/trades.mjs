/**
 * /api/trades — TradeExecution history with filtering by strategy and chain.
 */

import { getPrisma } from '../../db/index.mjs';

export async function registerTradeRoutes(app) {
  app.get('/api/trades', async (req) => {
    const prisma = getPrisma();
    const take = clamp(Number(req.query?.take) || 100, 1, 500);
    const cursor = req.query?.cursor ? String(req.query.cursor) : null;

    const where = {};
    if (req.query?.strategyType) where.strategyType = String(req.query.strategyType);
    if (req.query?.chain) where.chain = String(req.query.chain);
    if (req.query?.success === 'true') where.success = true;
    if (req.query?.success === 'false') where.success = false;

    const [rows, totals] = await Promise.all([
      prisma.tradeExecution.findMany({
        where,
        take,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.tradeExecution.groupBy({
        by: ['success'],
        _count: { _all: true },
      }),
    ]);

    return {
      rows,
      nextCursor: rows.length === take ? rows[rows.length - 1].id : null,
      totals: {
        success: totals.find((t) => t.success)?._count._all || 0,
        failure: totals.find((t) => !t.success)?._count._all || 0,
      },
    };
  });
}

function clamp(n, lo, hi) {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
