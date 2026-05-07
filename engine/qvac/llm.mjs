/**
 * Local LLM adapter — chats with the QVAC llama.cpp wrapper running in
 * the Bare-runtime sidecar.
 *
 * Public API:
 *   const llm = await createLLM();
 *   const result = await llm.chat({ messages, onToken, abortSignal, stopOnToolCall });
 *     // result: { text, raw, toolCalls, stoppedEarly, stats }
 *   await llm.cancel();
 *   await llm.unload();
 *
 * Tool-call parsing:
 *   The sidecar streams raw tokens; this module collects them into a
 *   buffer, optionally short-circuits when a `<tool_call>` block closes,
 *   and parses tool calls in the conventions used by Qwen 2.5/3, Hermes-3,
 *   Llama-3.1 Instruct, and Mistral-Nemo Instruct. The Vercel AI SDK
 *   provider (`ai-sdk-provider/`) consumes this to emit V2 stream parts.
 */

import { basename } from 'node:path';
import env from '../config.mjs';
import { createLogger } from '../core/logger.mjs';
import { QvacUnavailableError, assertModelFile } from './index.mjs';
import { getSidecar } from './sidecar/client.mjs';

const log = createLogger('qvac-llm');

const TOOL_CALL_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
const MISTRAL_TOOL_RE = /\[TOOL_CALLS\]\s*(\[[\s\S]*?\])\s*(?:\[\/TOOL_CALLS\]|$)/;
// AEGIS native fence: triple-backtick `tool_call` blocks. Unlike <tool_call>
// XML tags, this format does not collide with reserved chat-template tokens
// in Qwen / Hermes / Llama instruct GGUFs, so the model can emit the full
// JSON body and a closing fence without being prematurely terminated by the
// template's tool-call structural marker.
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

  // AEGIS native: ```tool_call ... ``` fenced JSON. Doesn't collide with
  // Qwen/Hermes reserved tokens and round-trips reliably across models.
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

export async function createLLM() {
  const modelPath = env.QVAC_LLM_MODEL_PATH;
  assertModelFile('llm', modelPath);

  const sidecar = getSidecar();
  // Pre-warm the sidecar process (lazy spawn, ~ready handshake) but do NOT
  // call llm-chat here. The QVAC LlmLlamacpp loads its model once at the
  // first chat call with the config provided at that moment — sending a
  // dummy chat with `predict: 1` would lock the model's predict config to
  // 1 token forever. The first real chat() carries the right predict value
  // and triggers the model load.
  try {
    await sidecar.request('ping');
  } catch (err) {
    if (err.code === 'qvac_sidecar_unavailable') {
      throw new QvacUnavailableError('llm', err.reason || err.message);
    }
    throw new QvacUnavailableError('llm', err.message || String(err));
  }
  log.info({ model: basename(modelPath), device: env.QVAC_LLM_DEVICE }, 'QVAC LLM ready (model loads on first chat)');

  async function chat({ messages, onToken, abortSignal, stopOnToolCall = true } = {}) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('chat(): messages must be a non-empty array');
    }
    const result = await sidecar.request('llm-chat', {
      modelPath,
      device: env.QVAC_LLM_DEVICE,
      gpuLayers: env.QVAC_LLM_GPU_LAYERS,
      ctxSize: env.QVAC_LLM_CTX_SIZE,
      temp: env.QVAC_LLM_TEMP,
      predict: env.QVAC_LLM_PREDICT,
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
