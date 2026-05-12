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
import { getToolRegistry } from './tools/index.mjs';
import { discoverSkills, renderSkillsPrompt, makeLoadSkillTool, makeReadSkillFileTool } from './skills.mjs';
import { getHistory, appendHistory, clearHistory } from './db-memory.mjs';
import { withinBudget, remainingBudget } from './db-budget.mjs';
import { createTurnTelemetry } from './telemetry.mjs';
import { getPrisma } from '../db/index.mjs';
import { resolveModel, isValidModel, SUBSCRIPTION_MODELS } from './resolve-model.mjs';

const log = createLogger('agent');

const FACT_PRELOAD_LIMIT = 20;

let _agent = null;
let _agentKey = null;

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
  _agentKey = null;
  return listSkills();
}

export async function getAgent({ model, walletName, walletAddress, defaultChain, turnProfile = 'interactive' } = {}) {
  const modelId = model || env.AEGIS_AGENT_MODEL;
  const agentKey = `${modelId}:${turnProfile}`;

  if (_agent && _agentKey === agentKey) {
    return _agent;
  }

  const languageModel = await resolveModel(modelId);
  const skills = loadSkillsOnce();
  const baseTools = getToolRegistry(turnProfile);
  const skillsEnabled = turnProfile === 'interactive';
  const skillsBlock = skillsEnabled ? renderSkillsPrompt(skills) : '';
  const baseSystem = buildSystemPrompt({
    walletName: walletName || env.DEFAULT_WALLET || 'default',
    walletAddress,
    defaultChain: defaultChain || env.DEFAULT_CHAIN,
    turnProfile,
  });
  const system = skillsBlock ? `${baseSystem}\n\n${skillsBlock}` : baseSystem;

  const skillTools = skillsEnabled && skills.length
    ? { loadSkill: makeLoadSkillTool(skills), readSkillFile: makeReadSkillFileTool(skills) }
    : {};

  _agent = new ToolLoopAgent({
    id: 'aegis-agent',
    model: languageModel,
    system,
    tools: { ...baseTools, ...skillTools },
  });
  _agentKey = agentKey;

  log.info({
    model: modelId,
    profile: turnProfile,
    tools: Object.keys(baseTools).length + Object.keys(skillTools).length,
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
  _agentKey = null;
  log.info({ model: modelId }, 'Active model switched');
  return modelId;
}

export function getActiveModel() {
  return env.AEGIS_AGENT_MODEL;
}

export function getAvailableModels() {
  return [...SUBSCRIPTION_MODELS];
}

export function hasExplicitExecutionIntent(prompt) {
  if (typeof prompt !== 'string') return false;
  const text = prompt.trim().toLowerCase();
  if (!text) return false;
  const action = /\b(execute|swap|buy|sell|trade|bridge|rebalance|convert)\b/.test(text);
  const urgency = /\b(now|right now|immediately|execute now|go ahead|proceed|do it)\b/.test(text);
  const hasAmount = /\b\d+(\.\d+)?\b/.test(text);
  const routedPair = /\bto\b/.test(text) || /->|→/.test(text);
  return action && (urgency || (hasAmount && routedPair));
}

function buildIntentDirective({ prompt, turnProfile }) {
  if (typeof prompt !== 'string' || !prompt.trim()) return null;
  if (hasExplicitExecutionIntent(prompt)) {
    return {
      role: 'system',
      content:
        'Execution intent is already explicit in the user message. If the user supplied a concrete trade, ' +
        'get the live quote and continue to execution in the same turn when the policy/approval path allows it. ' +
        'Do not stop after quoting just to ask for confirmation unless required inputs are missing, a policy denies, ' +
        'or the tool layer emits an approval request.',
    };
  }
  if (turnProfile === 'scheduled') {
    return {
      role: 'system',
      content:
        'This is a scheduled/background turn. Keep the response short and operator-facing. ' +
        'If the prompt explicitly directs an onchain action and the policy/approval path allows it, you may execute it. ' +
        'If there is nothing material to report, reply with exactly "NO_UPDATE".',
    };
  }
  return null;
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

async function buildInputMessages({ userId, prompt, messages, turnProfile = 'interactive' }) {
  if (messages) return messages;
  const history = userId ? await getHistory(userId) : [];
  const out = history.map(({ role, content }) => ({ role, content }));
  if (prompt) {
    const intentMsg = buildIntentDirective({ prompt, turnProfile });
    if (intentMsg) out.push(intentMsg);
    const factMsg = turnProfile === 'interactive' || turnProfile === 'scheduled'
      ? await loadFactPreload(userId)
      : null;
    if (factMsg) out.push(factMsg);
    out.push({ role: 'user', content: prompt });
  }
  return out;
}

function decoratePromptForHistory(prompt, source) {
  if (!prompt || typeof prompt !== 'string') return prompt;
  if (source === 'scheduled') return `[Scheduled task] ${prompt}`;
  if (source === 'system') return `[System follow-up] ${prompt}`;
  return prompt;
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
  turnProfile = 'interactive',
} = {}) {
  if (!skipBudget && userId && !(await withinBudget(userId))) {
    const remaining = await remainingBudget(userId);
    throw Object.assign(
      new Error(`Agent budget exhausted for ${userId}. Remaining this hour: ${remaining}.`),
      { code: 'budget_exhausted', userId }
    );
  }

  const agent = await getAgent({ model, walletName, walletAddress, turnProfile });
  const inputMessages = await buildInputMessages({ userId, prompt, messages, turnProfile });

  const telemetry = createTurnTelemetry({
    userId,
    source,
    model: model || env.AEGIS_AGENT_MODEL,
    turnProfile,
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
    await appendHistory(
      userId,
      [{ role: 'user', content: decoratePromptForHistory(prompt, source) }],
      { source, chatId, metadata: { turnProfile } },
    );
  }
  if (userId && Array.isArray(result.response?.messages)) {
    await appendHistory(userId, result.response.messages, { source, chatId, metadata: { turnProfile } });
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
 * Streaming variant — retained for programmatic / adapter-driven surfaces.
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
  turnProfile = 'interactive',
} = {}) {
  if (!skipBudget && userId && !(await withinBudget(userId))) {
    const remaining = await remainingBudget(userId);
    throw Object.assign(
      new Error(`Agent budget exhausted for ${userId}. Remaining this hour: ${remaining}.`),
      { code: 'budget_exhausted', userId }
    );
  }

  const agent = await getAgent({ model, walletName, walletAddress, turnProfile });
  const inputMessages = await buildInputMessages({ userId, prompt, messages, turnProfile });

  const telemetry = createTurnTelemetry({
    userId,
    source,
    model: model || env.AEGIS_AGENT_MODEL,
    turnProfile,
  });

  if (typeof onEvents === 'function') {
    try { onEvents(telemetry.events); } catch { /* swallow subscriber errors */ }
  }

  if (!messages && prompt && userId) {
    await appendHistory(
      userId,
      [{ role: 'user', content: decoratePromptForHistory(prompt, source) }],
      { source, chatId, metadata: { turnProfile } },
    );
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
