/**
 * /api/agent/* — AgentInvocation + AgentToolCall reads.
 *
 * Lists are paginated by `take` + `cursor` (id). Drill-in returns the
 * invocation with its tool calls in chronological order so the UI can
 * render a timeline.
 */

import { getPrisma } from '../../db/index.mjs';

export async function registerAgentRoutes(app) {
  app.get('/api/agent/invocations', async (req) => {
    const prisma = getPrisma();
    const take = clamp(Number(req.query?.take) || 50, 1, 200);
    const cursor = req.query?.cursor ? String(req.query.cursor) : null;

    const rows = await prisma.agentInvocation.findMany({
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        userId: true,
        source: true,
        model: true,
        status: true,
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        steps: true,
        durationMs: true,
        error: true,
        startedAt: true,
        finishedAt: true,
        _count: { select: { toolCalls: true } },
      },
    });

    return {
      rows,
      nextCursor: rows.length === take ? rows[rows.length - 1].id : null,
    };
  });

  app.get('/api/agent/invocations/:id', async (req, reply) => {
    const prisma = getPrisma();
    const inv = await prisma.agentInvocation.findUnique({
      where: { id: req.params.id },
      include: {
        toolCalls: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!inv) {
      reply.code(404).send({ error: 'invocation_not_found' });
      return;
    }
    return inv;
  });

  app.get('/api/agent/tool-calls', async (req) => {
    const prisma = getPrisma();
    const take = clamp(Number(req.query?.take) || 100, 1, 500);
    const toolName = req.query?.tool ? String(req.query.tool) : undefined;

    const rows = await prisma.agentToolCall.findMany({
      take,
      where: toolName ? { toolName } : undefined,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        invocationId: true,
        userId: true,
        toolName: true,
        success: true,
        durationMs: true,
        errorMsg: true,
        createdAt: true,
      },
    });

    // Aggregate per-tool stats over the same window for the right-rail
    // pie chart on the agent runs page.
    const stats = await prisma.agentToolCall.groupBy({
      by: ['toolName'],
      _count: { _all: true },
      orderBy: { _count: { toolName: 'desc' } },
      take: 20,
    });

    return {
      rows,
      stats: stats.map((s) => ({ toolName: s.toolName, count: s._count._all })),
    };
  });
}

function clamp(n, lo, hi) {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
