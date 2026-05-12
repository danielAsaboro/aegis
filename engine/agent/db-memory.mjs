/**
 * Per-user conversation memory backed by Prisma (SQLite).
 *
 * Raw history is capped per user. Older turns are compacted into AgentFact
 * summary rows before deletion so long-running sessions keep durable context
 * without replaying every historical tool payload forever.
 */

import { getPrisma } from '../db/index.mjs';

const MAX_MESSAGES = 60;
const MAX_SUMMARIES = 8;

function serializeContent(content) {
  if (typeof content === 'string') return content;
  return JSON.stringify(content);
}

function deserializeContent(raw) {
  if (typeof raw !== 'string') return raw;
  if (raw.length === 0) return raw;
  const head = raw[0];
  if (head !== '[' && head !== '{' && head !== '"') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function extractText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== 'object') return '';
        if (part.type === 'text' && typeof part.text === 'string') return part.text.trim();
        if (part.type === 'tool-call') return `[tool:${part.toolName || 'unknown'}]`;
        if (part.type === 'tool-approval-request') return `[approval:${part.approvalId || 'pending'}]`;
        if (part.type === 'tool-approval-response') return `[approval:${part.approvalId || 'pending'}=${part.approved ? 'approved' : 'denied'}]`;
        return '';
      })
      .filter(Boolean)
      .join(' ')
      .trim();
  }
  if (typeof content === 'object') {
    try { return JSON.stringify(content); } catch { return ''; }
  }
  return String(content);
}

function buildSummaryContent(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const start = rows[0].createdAt?.toISOString?.() ?? new Date(rows[0].createdAt).toISOString();
  const end = rows[rows.length - 1].createdAt?.toISOString?.() ?? new Date(rows[rows.length - 1].createdAt).toISOString();
  const lines = rows.map((row) => {
    const src = row.source || 'unknown';
    const text = extractText(deserializeContent(row.content)).replace(/\s+/g, ' ').slice(0, 180);
    return `- [${src}] ${row.role}: ${text || '(non-text turn)'}`;
  });
  return `Session summary ${start} → ${end}\n${lines.join('\n')}`;
}

async function trimSummaryFacts(prisma, userId) {
  const rows = await prisma.agentFact.findMany({
    where: { userId, category: 'history-summary' },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });
  if (rows.length <= MAX_SUMMARIES) return;
  const stale = rows.slice(MAX_SUMMARIES);
  await prisma.agentFact.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
}

async function compactHistory(prisma, userId) {
  const total = await prisma.agentMessage.count({ where: { userId } });
  if (total <= MAX_MESSAGES) return;

  const excess = total - MAX_MESSAGES;
  const rows = await prisma.agentMessage.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: excess,
  });
  if (rows.length === 0) return;

  const summary = buildSummaryContent(rows);
  const firstId = rows[0].id;
  const lastId = rows[rows.length - 1].id;
  const key = `history_summary_${String(firstId).padStart(8, '0')}_${String(lastId).padStart(8, '0')}`;

  await prisma.agentFact.upsert({
    where: { userId_key: { userId, key } },
    update: { value: summary, category: 'history-summary' },
    create: {
      userId,
      key,
      value: summary,
      category: 'history-summary',
    },
  });

  await trimSummaryFacts(prisma, userId);
  await prisma.agentMessage.deleteMany({
    where: { id: { in: rows.map((row) => row.id) } },
  });
}

export async function getHistory(userId, opts = {}) {
  if (!userId) return [];
  const limit = Number.isFinite(opts.limit) ? Number(opts.limit) : MAX_MESSAGES;
  const where = { userId: String(userId) };
  if (opts.source) where.source = String(opts.source);
  const rows = await getPrisma().agentMessage.findMany({
    where,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
  });
  return rows.map((r) => ({
    role: r.role,
    content: deserializeContent(r.content),
    source: r.source,
    chatId: r.chatId,
    metadata: deserializeContent(r.metadata),
  }));
}

export async function appendHistory(userId, msgs, opts = {}) {
  if (!userId || !Array.isArray(msgs) || msgs.length === 0) return;
  const key = String(userId);
  const prisma = getPrisma();
  const source = String(opts.source || 'unknown');
  const chatId = opts.chatId != null ? String(opts.chatId) : null;
  const metadata = opts.metadata === undefined ? null : serializeContent(opts.metadata);

  await prisma.agentMessage.createMany({
    data: msgs.map((m) => ({
      userId: key,
      role: m.role,
      content: serializeContent(m.content),
      source,
      chatId,
      metadata,
    })),
  });
  await compactHistory(prisma, key);
}

export async function clearHistory(userId) {
  if (!userId) return;
  await getPrisma().agentMessage.deleteMany({ where: { userId: String(userId) } });
}

function relativeTime(date) {
  if (!date) return '';
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function extractFirstText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content.slice(0, 60);
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === 'object' && part.type === 'text' && part.text) {
        return String(part.text).slice(0, 60);
      }
    }
  }
  return '';
}

export async function listSessions(prefix = 'tui-') {
  const prisma = getPrisma();
  const groups = await prisma.agentMessage.groupBy({
    by: ['userId'],
    where: { userId: { startsWith: prefix } },
    _max: { createdAt: true },
    _count: { id: true },
    orderBy: { _max: { createdAt: 'desc' } },
    take: 20,
  });
  return Promise.all(groups.map(async (g) => {
    const first = await prisma.agentMessage.findFirst({
      where: { userId: g.userId, role: 'user' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { content: true },
    });
    return {
      id: g.userId,
      msg_count: g._count.id,
      last_seen: relativeTime(g._max.createdAt),
      first_msg: first ? extractFirstText(deserializeContent(first.content)) : '',
    };
  }));
}
