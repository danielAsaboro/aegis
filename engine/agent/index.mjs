/**
 * AEGIS LLM Agent — entry point.
 *
 * Wraps Vercel AI SDK 6's `ToolLoopAgent` with the AEGIS tool registry,
 * Prisma-backed per-user message history, an invocation budget, telemetry
 * (AgentInvocation + AgentToolCall rows + live event stream), and a system
 * prompt that keeps the model honest about what it can and can't claim
 * happened.
 */

import { ToolLoopAgent } from 'ai';
import env from '../config.mjs';
import { createLogger } from '../core/logger.mjs';
import { buildSystemPrompt } from './system-prompt.mjs';
import { allTools } from './tools/index.mjs';
import { discoverSkills, renderSkillsPrompt, makeLoadSkillTool, makeReadSkillFileTool } from './skills.mjs';
import { getHistory, appendHistory, clearHistory } from './db-memory.mjs';
import { withinBudget, remainingBudget } from './db-budget.mjs';
import { createTurnTelemetry } from './telemetry.mjs';
import { getPrisma } from '../db/index.mjs';
import { resolveModel, isValidModel, SUBSCRIPTION_MODELS } from './resolve-model.mjs';

const log = createLogger('agent');

const FACT_PRELOAD_LIMIT = 20;

let _agent = null;
let _agentModelId = null;

let _skills = null;
function loadSkillsOnce() {
  if (_skills) return _skills;
  _skills = discoverSkills();
  if (_skills.length > 0) {
    log.info({ count: _skills.length, names: _skills.map(s => s.name) }, 'Agent skills discovered');
  }
  return _skills;
}

export function listSkills() {
  return loadSkillsOnce().map(s => ({ name: s.name, description: s.description, source: s.source }));
}

export function refreshSkills() {
  _skills = null;
  // Force agent rebuild on next turn so the new skill list is picked up.
  _agent = null;
  _agentModelId = null;
  return listSkills();
}

export async function getAgent({ model, walletName, walletAddress, defaultChain } = {}) {
  const modelId = model || env.AEGIS_AGENT_MODEL;

  if (_agent && _agentModelId === modelId) {
    return _agent;
  }

  const languageModel = await resolveModel(modelId);
  const skills = loadSkillsOnce();
  const skillsBlock = renderSkillsPrompt(skills);
  const baseSystem = buildSystemPrompt({
    walletName: walletName || env.DEFAULT_WALLET || 'default',
    walletAddress,
    defaultChain: defaultChain || env.DEFAULT_CHAIN,
  });
  const system = skillsBlock ? `${baseSystem}\n\n${skillsBlock}` : baseSystem;

  const skillTools = skills.length
    ? { loadSkill: makeLoadSkillTool(skills), readSkillFile: makeReadSkillFileTool(skills) }
    : {};

  _agent = new ToolLoopAgent({
    id: 'aegis-agent',
    model: languageModel,
    system,
    tools: { ...allTools, ...skillTools },
  });
  _agentModelId = modelId;

  log.info({
    model: modelId,
    tools: Object.keys(allTools).length + Object.keys(skillTools).length,
    skills: skills.length,
  }, 'Agent built');
  return _agent;
}

export function setActiveModel(modelId) {
  if (!isValidModel(modelId)) {
    throw new Error(
      `Unknown model "${modelId}". Available: ${SUBSCRIPTION_MODELS.join(', ')}. ` +
      `AEGIS supports subscription models (codex/* via local Codex CLI) and ` +
      `local models (qvac/* via on-device QVAC sidecar). API-key billed paths are not supported.`
    );
  }
  env.AEGIS_AGENT_MODEL = modelId;
  _agent = null;
  _agentModelId = null;
  log.info({ model: modelId }, 'Active model switched');
  return modelId;
}

export function getActiveModel() {
  return _agentModelId || env.AEGIS_AGENT_MODEL;
}

export function getAvailableModels() {
  return [...SUBSCRIPTION_MODELS];
}

async function loadFactPreload(userId) {
  if (!userId) return null;
  try {
    const rows = await getPrisma().agentFact.findMany({
      where: { userId: String(userId) },
      orderBy: { updatedAt: 'desc' },
      take: FACT_PRELOAD_LIMIT,
    });
    if (rows.length === 0) return null;
    const lines = rows.map(r => {
      const cat = r.category ? ` [${r.category}]` : '';
      return `- ${r.key}${cat}: ${r.value}`;
    });
    return {
      role: 'system',
      content: `Remembered facts about this user (most recent first):\n${lines.join('\n')}`,
    };
  } catch {
    return null;
  }
}

async function buildInputMessages({ userId, prompt, messages }) {
  if (messages) return messages;
  const history = userId ? await getHistory(userId) : [];
  const out = [...history];
  if (prompt) {
    const factMsg = await loadFactPreload(userId);
    if (factMsg) out.push(factMsg);
    out.push({ role: 'user', content: prompt });
  }
  return out;
}

function isAbortError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  if (err.code === 'ABORT_ERR' || err.code === 20) return true;
  if (typeof err.message === 'string' && /aborted|cancell?ed/i.test(err.message)) return true;
  return false;
}

function extractMessageText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(part => part?.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n')
    .trim();
}

function normalizeTurnText(result) {
  if (typeof result?.text === 'string' && result.text.length > 0) return result.text;
  if (typeof result?.outputText === 'string' && result.outputText.length > 0) return result.outputText;
  if (typeof result?._output === 'string' && result._output.length > 0) return result._output;
  if (Array.isArray(result?.response?.messages)) {
    for (let idx = result.response.messages.length - 1; idx >= 0; idx -= 1) {
      const msg = result.response.messages[idx];
      if (msg?.role !== 'assistant') continue;
      const text = extractMessageText(msg.content);
      if (text) return text;
    }
  }
  if (Array.isArray(result?.steps)) {
    for (let idx = result.steps.length - 1; idx >= 0; idx -= 1) {
      const text = extractMessageText(result.steps[idx]?.content);
      if (text) return text;
    }
  }
  return '';
}

/**
 * Run one agent turn.
 *
 * Pass either a pre-built `abortSignal` to forward, or rely on the
 * AbortController this function creates and returns under `controller` so the
 * caller can cancel mid-turn.
 *
 * @returns {Promise<{ text, toolCalls, toolResults, steps, response, events, invocationId, controller }>}
 */
export async function runAgentTurn({
  prompt,
  userId,
  chatId,
  source = 'cli',
  walletName,
  walletAddress,
  model,
  messages,
  skipBudget = false,
  onEvents,
  abortSignal,
} = {}) {
  if (!skipBudget && userId && !(await withinBudget(userId))) {
    const remaining = await remainingBudget(userId);
    throw Object.assign(
      new Error(`Agent budget exhausted for ${userId}. Remaining this hour: ${remaining}.`),
      { code: 'budget_exhausted', userId }
    );
  }

  const agent = await getAgent({ model, walletName, walletAddress });
  const inputMessages = await buildInputMessages({ userId, prompt, messages });

  const telemetry = createTurnTelemetry({
    userId,
    source,
    model: model || env.AEGIS_AGENT_MODEL,
  });

  if (typeof onEvents === 'function') {
    try { onEvents(telemetry.events); } catch { /* never let subscriber errors break the turn */ }
  }

  const controller = new AbortController();
  if (abortSignal) {
    if (abortSignal.aborted) controller.abort(abortSignal.reason);
    else abortSignal.addEventListener('abort', () => controller.abort(abortSignal.reason), { once: true });
  }

  let result;
  try {
    result = await agent.generate({
      messages: inputMessages,
      abortSignal: controller.signal,
      experimental_context: { userId, chatId, source, walletName, walletAddress },
      ...telemetry.callbacks,
    });
  } catch (err) {
    if (isAbortError(err) || controller.signal.aborted) {
      await telemetry.markAborted();
      const abortErr = Object.assign(new Error('Agent turn aborted'), { code: 'AbortError', name: 'AbortError' });
      throw abortErr;
    }
    await telemetry.markError(err);
    throw err;
  }

  if (!messages && prompt && userId) {
    await appendHistory(userId, [{ role: 'user', content: prompt }]);
  }
  if (userId && Array.isArray(result.response?.messages)) {
    await appendHistory(userId, result.response.messages);
  }

  return {
    ...result,
    text: normalizeTurnText(result),
    events: telemetry.events,
    invocationId: telemetry.getInvocationId(),
    controller,
  };
}

/**
 * Streaming variant — used by the CLI REPL.
 */
export async function streamAgentTurn({
  prompt,
  userId,
  chatId,
  source = 'cli',
  walletName,
  walletAddress,
  model,
  messages,
  skipBudget = false,
  onEvents,
  abortSignal,
} = {}) {
  if (!skipBudget && userId && !(await withinBudget(userId))) {
    const remaining = await remainingBudget(userId);
    throw Object.assign(
      new Error(`Agent budget exhausted for ${userId}. Remaining this hour: ${remaining}.`),
      { code: 'budget_exhausted', userId }
    );
  }

  const agent = await getAgent({ model, walletName, walletAddress });
  const inputMessages = await buildInputMessages({ userId, prompt, messages });

  const telemetry = createTurnTelemetry({
    userId,
    source,
    model: model || env.AEGIS_AGENT_MODEL,
  });

  if (typeof onEvents === 'function') {
    try { onEvents(telemetry.events); } catch { /* swallow subscriber errors */ }
  }

  if (!messages && prompt && userId) {
    await appendHistory(userId, [{ role: 'user', content: prompt }]);
  }

  const controller = new AbortController();
  if (abortSignal) {
    if (abortSignal.aborted) controller.abort(abortSignal.reason);
    else abortSignal.addEventListener('abort', () => controller.abort(abortSignal.reason), { once: true });
  }

  const stream = await agent.stream({
    messages: inputMessages,
    abortSignal: controller.signal,
    experimental_context: { userId, chatId, source, walletName, walletAddress },
    ...telemetry.callbacks,
  });

  // Caller is responsible for awaiting stream.response.messages and
  // appending them via appendHistory(userId, ...) once the stream finalizes.
  stream.events = telemetry.events;
  stream.invocationId = telemetry.getInvocationId();
  stream.controller = controller;
  return stream;
}

export { clearHistory, getHistory, appendHistory };
