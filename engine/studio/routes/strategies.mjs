/**
 * /api/strategies/* — DCA plans, rebalance targets, price alerts.
 *
 * Each row returns parsed `policiesJson`/`targetsJson` so the UI doesn't
 * have to JSON.parse on the client.
 */

import { getPrisma } from '../../db/index.mjs';

export async function registerStrategyRoutes(app) {
  app.get('/api/strategies/dca', async () => {
    const prisma = getPrisma();
    const rows = await prisma.dCAPlan.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(parseDcaRow);
  });

  app.get('/api/strategies/rebalance', async () => {
    const prisma = getPrisma();
    const rows = await prisma.rebalanceTarget.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      ...r,
      targets: safeJson(r.targetsJson, []),
      policies: safeJson(r.policiesJson, {}),
    }));
  });

  app.get('/api/strategies/alerts', async () => {
    const prisma = getPrisma();
    const rows = await prisma.priceAlert.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      ...r,
      policies: safeJson(r.policiesJson, {}),
    }));
  });

  app.get('/api/strategies/spend', async () => {
    const prisma = getPrisma();
    const rows = await prisma.spendTracking.findMany({});
    return rows.map((r) => ({
      ...r,
      history: safeJson(r.historyJson, []),
    }));
  });

  app.get('/api/strategies/proposals', async () => {
    const prisma = getPrisma();
    const rows = await prisma.groupProposal.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => ({
      ...r,
      votes: safeJson(r.votesJson, {}),
    }));
  });

  app.get('/api/strategies/scheduled', async () => {
    const prisma = getPrisma();
    const rows = await prisma.scheduledJob.findMany({
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    });
    return rows.map((r) => ({
      ...r,
      payload: safeJson(r.payloadJson, {}),
    }));
  });
}

function parseDcaRow(r) {
  return {
    ...r,
    policies: safeJson(r.policiesJson, {}),
  };
}

function safeJson(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
