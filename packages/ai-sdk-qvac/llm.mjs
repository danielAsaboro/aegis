/**
 * Local LLM adapter — chats with the QVAC llama.cpp wrapper running in
 * the Bare-runtime sidecar.
 *
 * Vendored from AEGIS for the published `ai-sdk-qvac` package; reads
 * configuration directly from `process.env` (no AEGIS config dependency).
 *
 * Public API:
 *   const llm = await createLLM();
 *   const result = await llm.chat({ messages, onToken, abortSignal, stopOnToolCall });
 *     // result: { text, raw, toolCalls, stoppedEarly, stats }
 *   await llm.cancel();
 *   await llm.unload();
 */

import { basename } from 'node:path';
import { createLogger } from './_logger.mjs';
import { QvacUnavailableError, assertModelFile } from './errors.mjs';
import { getSidecar } from './sidecar/client.mjs';

const log = createLogger('llm');

const TOOL_CALL_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
const MISTRAL_TOOL_RE = /\[TOOL_CALLS\]\s*(\[[\s\S]*?\])\s*(?:\[\/TOOL_CALLS\]|$)/;
const TOOL_FENCE_RE = /```(?:tool_call|tool|json)?\s*\n?(\{[\s\S]*?\})\s*\n?```/gi;
const TOOL_FENCE_CALL_RE = /```(?:tool_call|tool|json)?\s*\n?([A-Za-z_][\w]*)\s*\(([\s\S]*?)\)\s*\n?```/gi;

function safeParseJsonObject(s) {
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return { _raw: s }; }
}

function nextToolCallId(prefix, idx) {
  return `${prefix}-${Date.now()}-${idx}`;
}

export function parseToolCalls(rawText, { idPrefix = 'qvac' } = {}) {
  if (typeof rawText !== 'string' || !rawText) {
    return { text: '', toolCalls: [] };
  }
  const calls = [];
  let stripped = rawText;
  let idx = 0;

  for (const m of rawText.matchAll(TOOL_CALL_RE)) {
    const payload = m[1].trim();
    try {
      const parsed = JSON.parse(payload);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const c of arr) {
        if (!c || typeof c !== 'object') continue;
        const name = c.name || c.tool || c.tool_name;
        if (!name) continue;
        const args = c.arguments ?? c.parameters ?? c.input ?? c.args ?? {};
        calls.push({
          id: nextToolCallId(idPrefix, idx++),
          name: String(name),
          arguments: typeof args === 'string' ? safeParseJsonObject(args) : args,
        });
      }
    } catch (err) {
      log.warn({ err: err.message, payload: payload.slice(0, 200) }, 'failed to parse tool_call JSON');
    }
    stripped = stripped.replace(m[0], '');
  }

  if (calls.length === 0) {
    for (const m of rawText.matchAll(TOOL_FENCE_RE)) {
      const payload = m[1].trim();
      try {
        const parsed = JSON.parse(payload);
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        for (const c of arr) {
          if (!c || typeof c !== 'object') continue;
          const name = c.name || c.tool || c.tool_name;
          if (!name) continue;
          const args = c.arguments ?? c.parameters ?? c.input ?? c.args ?? {};
          calls.push({
            id: nextToolCallId(idPrefix, idx++),
            name: String(name),
            arguments: typeof args === 'string' ? safeParseJsonObject(args) : args,
          });
        }
        stripped = stripped.replace(m[0], '');
      } catch (err) {
        log.warn({ err: err.message, payload: payload.slice(0, 200) }, 'failed to parse fenced tool_call JSON');
      }
    }
  }

  if (calls.length === 0) {
    for (const m of rawText.matchAll(TOOL_FENCE_CALL_RE)) {
      const name = m[1];
      const payload = (m[2] || '').trim();
      const args = payload ? safeParseJsonObject(payload) : {};
      calls.push({
        id: nextToolCallId(idPrefix, idx++),
        name: String(name),
        arguments: args,
      });
      stripped = stripped.replace(m[0], '');
    }
  }

  if (calls.length === 0) {
    const mm = rawText.match(MISTRAL_TOOL_RE);
    if (mm) {
      try {
        const arr = JSON.parse(mm[1]);
        if (Array.isArray(arr)) {
          for (const c of arr) {
            const name = c?.name || c?.tool;
            if (!name) continue;
            calls.push({
              id: nextToolCallId(idPrefix, idx++),
              name: String(name),
              arguments: c.arguments ?? c.parameters ?? {},
            });
          }
          stripped = stripped.replace(mm[0], '');
        }
      } catch (err) {
        log.warn({ err: err.message }, 'failed to parse [TOOL_CALLS] JSON');
      }
    }
  }

  return { text: stripped.trim(), toolCalls: calls };
}

function llmConfig() {
  const num = (key, def) => {
    const raw = process.env[key];
    if (raw === undefined || raw === '') return def;
    const n = Number(raw);
    return Number.isFinite(n) ? n : def;
  };
  return {
    modelPath: process.env.QVAC_LLM_MODEL_PATH || '',
    device: process.env.QVAC_LLM_DEVICE || 'cpu',
    gpuLayers: num('QVAC_LLM_GPU_LAYERS', 99),
    ctxSize: num('QVAC_LLM_CTX_SIZE', 8192),
    temp: num('QVAC_LLM_TEMP', 0.4),
    predict: num('QVAC_LLM_PREDICT', 1024),
  };
}

export async function createLLM() {
  const cfg = llmConfig();
  assertModelFile('llm', cfg.modelPath);

  const sidecar = getSidecar();
  try {
    await sidecar.request('ping');
  } catch (err) {
    if (err.code === 'qvac_sidecar_unavailable') {
      throw new QvacUnavailableError('llm', err.reason || err.message);
    }
    throw new QvacUnavailableError('llm', err.message || String(err));
  }
  log.info({ model: basename(cfg.modelPath), device: cfg.device }, 'QVAC LLM ready (model loads on first chat)');

  async function chat({ messages, onToken, abortSignal, stopOnToolCall = true } = {}) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('chat(): messages must be a non-empty array');
    }
    const result = await sidecar.request('llm-chat', {
      modelPath: cfg.modelPath,
      device: cfg.device,
      gpuLayers: cfg.gpuLayers,
      ctxSize: cfg.ctxSize,
      temp: cfg.temp,
      predict: cfg.predict,
      messages,
      stopOnToolCall,
    }, {
      signal: abortSignal,
      onEvent: (name, data) => {
        if (name === 'token' && typeof onToken === 'function') {
          try { onToken(data); } catch {}
        }
      },
    });

    const buffer = result?.raw || '';
    const { text, toolCalls } = parseToolCalls(buffer);
    return {
      text,
      raw: buffer,
      toolCalls,
      stoppedEarly: !!result?.stoppedEarly,
      stats: result?.stats || null,
    };
  }

  async function cancel() {
    try { await sidecar.request('llm-cancel'); }
    catch (err) { log.warn({ err: err.message }, 'llm cancel failed'); }
  }

  async function unload() {
    try { await sidecar.request('unload', { target: 'llm' }); }
    catch (err) { log.warn({ err: err.message }, 'LLM unload failed'); }
  }

  return { chat, cancel, unload };
}

let _llm = null;
let _llmPromise = null;

export async function getLLM() {
  if (_llm) return _llm;
  if (!_llmPromise) {
    _llmPromise = createLLM().then((m) => { _llm = m; return m; }, (err) => {
      _llmPromise = null;
      throw err;
    });
  }
  return _llmPromise;
}
