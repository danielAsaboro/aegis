/**
 * In-memory chatId → threadId map for subscription-driven providers
 * (Codex MCP, Claude Code, Gemini CLI, ...). Each provider can keep a
 * conversation thread on its side; this map tells `runProviderTurn` which
 * thread to continue for a given AEGIS chat.
 *
 * In-memory is fine for now — Codex thread state itself lives in the Codex
 * server process which we re-spawn on every AEGIS run, and the upstream
 * threads expire on their own. If we later want resume-across-restart, this
 * is the seam to swap in a Prisma-backed store.
 */

const _map = new Map();

function key(provider, chatId) {
  return `${provider}::${chatId || 'default'}`;
}

export function getThreadId(provider, chatId) {
  return _map.get(key(provider, chatId)) || null;
}

export function setThreadId(provider, chatId, threadId) {
  if (!threadId) return;
  _map.set(key(provider, chatId), threadId);
}

export function clearThreadId(provider, chatId) {
  _map.delete(key(provider, chatId));
}
