/**
 * Per-user conversation memory backed by Prisma (SQLite).
 *
 * Replaces the in-process Map version. Capped at MAX_MESSAGES per userId;
 * oldest rows trimmed FIFO on append.
 */

import { getPrisma } from '../db/index.mjs';

const MAX_MESSAGES = 60;

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

export async function getHistory(userId) {
  if (!userId) return [];
  const rows = await getPrisma().agentMessage.findMany({
    where: { userId: String(userId) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_MESSAGES,
  });
  return rows.map(r => ({ role: r.role, content: deserializeContent(r.content) }));
}

export async function appendHistory(userId, msgs) {
  if (!userId || !Array.isArray(msgs) || msgs.length === 0) return;
  const key = String(userId);
  const prisma = getPrisma();

  await prisma.agentMessage.createMany({
    data: msgs.map(m => ({
      userId: key,
      role: m.role,
      content: serializeContent(m.content),
    })),
  });

  // Trim to MAX_MESSAGES, FIFO.
  const total = await prisma.agentMessage.count({ where: { userId: key } });
  if (total > MAX_MESSAGES) {
    const excess = total - MAX_MESSAGES;
    const oldest = await prisma.agentMessage.findMany({
      where: { userId: key },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: excess,
      select: { id: true },
    });
    if (oldest.length > 0) {
      await prisma.agentMessage.deleteMany({
        where: { id: { in: oldest.map(o => o.id) } },
      });
    }
  }
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
