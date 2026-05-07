/**
 * QvacLanguageModel — implements `@ai-sdk/provider` v2's LanguageModelV2.
 *
 * Slots a local-first LLM (running on @qvac/llm-llamacpp, fully on-device)
 * into the Vercel AI SDK exactly like `openai/*` and `anthropic/*` do.
 * `ToolLoopAgent.generate({ model: qvac('local'), tools, prompt })` works
 * verbatim — tool calls, approvals, telemetry, history compaction all keep
 * functioning unchanged.
 *
 * Tool calling:
 *   We instruct the model to emit `<tool_call>{"name":..., "arguments":...}</tool_call>`
 *   blocks. After streaming completes (or stops early on the closing tag),
 *   we parse the blocks and emit V2 tool-call content/stream parts. The
 *   AI SDK's tool loop then dispatches our tools and feeds results back.
 *
 * Prompt → llama.cpp messages:
 *   We flatten V2 multi-part messages into the chat schema llama.cpp's
 *   chat template understands ({role, content: string}). Files are
 *   refused with a warning (this is a text-only LLM); reasoning parts
 *   are inlined for context but never resurfaced as reasoning output.
 */

import { getLLM } from '../index.mjs';
import { parseToolCalls } from '../llm.mjs';

const PROVIDER_NAME = 'qvac';

function flattenContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content ?? '');
  const parts = [];
  for (const p of content) {
    if (!p || typeof p !== 'object') continue;
    switch (p.type) {
      case 'text': parts.push(p.text); break;
      case 'reasoning': parts.push(`(thinking) ${p.text}`); break;
      case 'tool-call': {
        const args = typeof p.input === 'string' ? p.input : JSON.stringify(p.input ?? {});
        parts.push(`<tool_call>${JSON.stringify({ name: p.toolName, arguments: safeJsonObj(args) })}</tool_call>`);
        break;
      }
      case 'tool-result': {
        const out = renderToolOutput(p.output);
        parts.push(`Tool ${p.toolName} (id=${p.toolCallId}) → ${out}`);
        break;
      }
      // file parts are rejected — reported via warnings on the call
    }
  }
  return parts.join('\n');
}

function safeJsonObj(s) {
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return s; }
}

function renderToolOutput(out) {
  if (!out) return 'null';
  switch (out.type) {
    case 'text': return out.value;
    case 'json': return JSON.stringify(out.value);
    case 'error-text': return `ERROR: ${out.value}`;
    case 'error-json': return `ERROR: ${JSON.stringify(out.value)}`;
    case 'content': {
      const t = out.value?.find?.(v => v.type === 'text');
      return t ? t.text : JSON.stringify(out.value);
    }
    default: return JSON.stringify(out);
  }
}

function describeJsonSchema(schema, depth = 0) {
  if (!schema || typeof schema !== 'object') return 'unknown';
  if (Array.isArray(schema.enum)) {
    return `enum(${schema.enum.map(v => JSON.stringify(v)).join('|')})`;
  }
  switch (schema.type) {
    case 'string': return 'string';
    case 'number':
    case 'integer': return 'number';
    case 'boolean': return 'boolean';
    case 'null': return 'null';
    case 'array': return `array<${describeJsonSchema(schema.items, depth + 1)}>`;
    case 'object': {
      if (depth > 4) return 'object';
      const props = schema.properties || {};
      const required = new Set(schema.required || []);
      const fields = Object.entries(props).map(([k, v]) => {
        const t = describeJsonSchema(v, depth + 1);
        return `${k}${required.has(k) ? '' : '?'}: ${t}`;
      });
      return `{ ${fields.join(', ')} }`;
    }
    default:
      if (schema.anyOf) return schema.anyOf.map(s => describeJsonSchema(s, depth + 1)).join('|');
      if (schema.oneOf) return schema.oneOf.map(s => describeJsonSchema(s, depth + 1)).join('|');
      return 'any';
  }
}

function renderToolCatalog(tools, toolChoice) {
  if (!tools || tools.length === 0) return null;
  const lines = [
    '# Tools',
    '',
    'You have access to the following functions. To call one, emit a fenced JSON block tagged `tool_call`. Emit exactly one block per turn, then stop generating — the harness runs the function and feeds the result back as a `tool` role message before you continue.',
    '',
    '## Available functions',
    '',
  ];
  for (const t of tools) {
    if (t.type === 'function') {
      const sig = describeJsonSchema(t.inputSchema);
      const desc = (t.description || '').replace(/\s+/g, ' ').trim();
      lines.push(`### ${t.name}`);
      if (desc) lines.push(desc);
      if (sig && sig !== 'unknown') lines.push(`Arguments: ${sig}`);
      lines.push('');
    } else if (t.type === 'provider-defined') {
      lines.push(`### ${t.name}`);
      lines.push(`Provider-defined tool ${t.id}`);
      lines.push('');
    }
  }
  lines.push('## Tool-call format');
  lines.push('When you need to call a function, emit ONE block in this exact form:');
  lines.push('');
  lines.push('```tool_call');
  lines.push('{"name": "<functionName>", "arguments": {<args matching the schema>}}');
  lines.push('```');
  lines.push('');
  lines.push('Examples:');
  lines.push('');
  lines.push('```tool_call');
  lines.push('{"name": "getPortfolio", "arguments": {}}');
  lines.push('```');
  lines.push('');
  lines.push('```tool_call');
  lines.push('{"name": "getSwapQuote", "arguments": {"fromToken": "SOL", "toToken": "USDC", "amount": "0.1"}}');
  lines.push('```');
  lines.push('');
  lines.push('Rules:');
  lines.push('- The fenced block must contain valid JSON with both "name" and "arguments" keys.');
  lines.push('- Use the literal language tag `tool_call` after the opening fence (not `json`).');
  lines.push('- Stop generating right after the closing ``` fence so the harness can run the tool.');
  lines.push('- After the tool result returns, you may call another tool or reply in plain text — but never claim a result before the tool is actually run.');
  if (toolChoice?.type === 'required') {
    lines.push('- This turn requires a tool call. Reply only with a tool_call block.');
  } else if (toolChoice?.type === 'tool') {
    lines.push(`- This turn must call the tool named "${toolChoice.toolName}".`);
  } else if (toolChoice?.type === 'none') {
    lines.push('- This turn must NOT call any tool. Reply in plain text only.');
  }
  return lines.join('\n');
}

/**
 * Map a V2 prompt (multi-part) to a flat chat-template-friendly array.
 * Returns { messages, warnings }.
 */
function convertPrompt(v2Prompt, toolCatalog) {
  const out = [];
  const warnings = [];
  let sawSystem = false;

  for (const m of v2Prompt) {
    // Reject file parts up-front (this is a text LLM).
    if (m.role === 'user' || m.role === 'assistant') {
      const arr = Array.isArray(m.content) ? m.content : [];
      for (const p of arr) {
        if (p?.type === 'file') {
          warnings.push({ type: 'other', message: `Skipping file part (mediaType=${p.mediaType}); QVAC LLM is text-only.` });
        }
      }
    }

    switch (m.role) {
      case 'system': {
        const base = typeof m.content === 'string' ? m.content : flattenContent(m.content);
        const merged = toolCatalog && !sawSystem ? `${base}\n\n${toolCatalog}` : base;
        out.push({ role: 'system', content: merged });
        sawSystem = true;
        break;
      }
      case 'user':
      case 'assistant':
        out.push({ role: m.role, content: flattenContent(m.content) });
        break;
      case 'tool': {
        // V2 'tool' role groups tool-result parts; flatten each into a
        // separate "user"-like injection so the chat template still sees
        // a continuous trace. Some local models recognise role:'tool',
        // others don't — inlining is the safe baseline.
        const arr = Array.isArray(m.content) ? m.content : [];
        for (const p of arr) {
          out.push({
            role: 'tool',
            content: `Tool ${p.toolName} (id=${p.toolCallId}) → ${renderToolOutput(p.output)}`,
          });
        }
        break;
      }
    }
  }

  if (toolCatalog && !sawSystem) {
    out.unshift({ role: 'system', content: toolCatalog });
  }

  return { messages: out, warnings };
}

function isAbortError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  if (err.code === 'AbortError' || err.code === 'ABORT_ERR') return true;
  return /aborted/i.test(err.message || '');
}

export class QvacLanguageModel {
  constructor(modelId, settings = {}, config = {}) {
    this.specificationVersion = 'v2';
    this.provider = config.provider || PROVIDER_NAME;
    this.modelId = modelId;
    this.settings = settings;
    this._config = config;
    this.supportedUrls = {};
  }

  async _llm() {
    return await getLLM();
  }

  async _runOnce({ prompt, tools, toolChoice, abortSignal, onTextDelta }) {
    const llm = await this._llm();
    const catalog = renderToolCatalog(tools, toolChoice);
    const { messages, warnings } = convertPrompt(prompt, catalog);

    let textBuffer = '';
    let suppressed = false;

    const result = await llm.chat({
      messages,
      abortSignal,
      stopOnToolCall: true,
      onToken: (piece) => {
        if (typeof onTextDelta !== 'function') return;
        if (suppressed) return;
        textBuffer += piece;
        // Suppress text once a tool-call opener appears mid-stream — we'll
        // emit the tool-call content part once the closing tag is parsed.
        if (/<tool_call>/.test(textBuffer)) {
          suppressed = true;
          return;
        }
        onTextDelta(piece);
      },
    });

    return { ...result, warnings };
  }

  async doGenerate(options) {
    const { prompt, tools, toolChoice, abortSignal } = options;

    let res;
    try {
      res = await this._runOnce({ prompt, tools, toolChoice, abortSignal });
    } catch (err) {
      if (isAbortError(err)) throw err;
      throw err;
    }

    const content = [];
    if (res.text) {
      content.push({ type: 'text', text: res.text });
    }
    for (const tc of res.toolCalls) {
      content.push({
        type: 'tool-call',
        toolCallId: tc.id,
        toolName: tc.name,
        input: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments ?? {}),
      });
    }

    const finishReason = res.toolCalls.length > 0 ? 'tool-calls' : 'stop';

    const usage = {
      inputTokens: res.stats?.inputTokens ?? res.stats?.input_tokens ?? undefined,
      outputTokens: res.stats?.outputTokens ?? res.stats?.output_tokens ?? res.stats?.total_tokens ?? undefined,
      totalTokens: res.stats?.total_tokens ?? undefined,
    };

    return {
      content,
      finishReason,
      usage,
      warnings: res.warnings || [],
      response: { id: `qvac-${Date.now()}`, modelId: this.modelId, timestamp: new Date() },
    };
  }

  async doStream(options) {
    const { prompt, tools, toolChoice, abortSignal } = options;
    const modelId = this.modelId;

    const stream = new ReadableStream({
      start: async (controller) => {
        const textId = `qvac-text-${Date.now()}`;
        let textStarted = false;
        let textEmitted = false;

        const emit = (part) => {
          try { controller.enqueue(part); } catch {}
        };

        try {
          const res = await this._runOnce({
            prompt, tools, toolChoice, abortSignal,
            onTextDelta: (delta) => {
              if (!textStarted) {
                emit({ type: 'stream-start', warnings: [] });
                emit({ type: 'text-start', id: textId });
                textStarted = true;
              }
              textEmitted = true;
              emit({ type: 'text-delta', id: textId, delta });
            },
          });

          if (!textStarted) {
            emit({ type: 'stream-start', warnings: res.warnings || [] });
          }

          if (textStarted) {
            emit({ type: 'text-end', id: textId });
          } else if (res.text) {
            // No streamed deltas (e.g. all output was suppressed because a
            // tool_call opener arrived in the same chunk) — emit a single
            // text part so callers see the cleaned text.
            emit({ type: 'text-start', id: textId });
            emit({ type: 'text-delta', id: textId, delta: res.text });
            emit({ type: 'text-end', id: textId });
            textEmitted = true;
          }

          for (const tc of res.toolCalls) {
            const inputStr = typeof tc.arguments === 'string'
              ? tc.arguments
              : JSON.stringify(tc.arguments ?? {});
            emit({ type: 'tool-input-start', id: tc.id, toolName: tc.name });
            emit({ type: 'tool-input-delta', id: tc.id, delta: inputStr });
            emit({ type: 'tool-input-end', id: tc.id });
            emit({
              type: 'tool-call',
              toolCallId: tc.id,
              toolName: tc.name,
              input: inputStr,
            });
          }

          const finishReason = res.toolCalls.length > 0 ? 'tool-calls' : (textEmitted || res.text ? 'stop' : 'other');

          emit({
            type: 'finish',
            finishReason,
            usage: {
              inputTokens: res.stats?.inputTokens ?? undefined,
              outputTokens: res.stats?.outputTokens ?? undefined,
              totalTokens: res.stats?.total_tokens ?? undefined,
            },
          });
          controller.close();
        } catch (err) {
          emit({ type: 'error', error: err });
          controller.close();
        }
      },
    });

    return { stream };
  }
}

export { parseToolCalls, renderToolCatalog, convertPrompt };
