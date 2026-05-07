/**
 * Codex AI SDK provider.
 *
 * This adapter treats the local Codex CLI as a raw language-model backend,
 * not as a nested agent loop. AEGIS remains the only owner of tools,
 * history, approvals, and telemetry; Codex just returns the next assistant
 * turn in the same tool-call fence contract QVAC uses.
 */

import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import env from '../../config.mjs';
import { createLogger } from '../../core/logger.mjs';
import { convertPrompt, renderToolCatalog } from '../../qvac/ai-sdk-provider/language-model.mjs';
import { parseToolCalls } from '../../qvac/llm.mjs';

const log = createLogger('codex-provider');

function isEnoent(err) {
  if (!err) return false;
  if (err.code === 'ENOENT') return true;
  const msg = String(err.message || err);
  return /ENOENT|not found|spawn .* ENOENT/i.test(msg);
}

function isAbortError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  if (err.code === 'ABORT_ERR' || err.code === 'AbortError') return true;
  return /aborted|cancell?ed/i.test(String(err.message || err));
}

function formatTranscript(messages) {
  return messages.map((message) => {
    const role = String(message.role || 'user').toUpperCase();
    return `${role}:\n${message.content}`;
  }).join('\n\n');
}

export function buildCodexPrompt(prompt, tools, toolChoice) {
  const toolCatalog = renderToolCatalog(tools, toolChoice);
  const { messages, warnings } = convertPrompt(prompt, toolCatalog);

  const rendered = [
    'You are producing the next assistant turn for the AEGIS application.',
    'Continue the transcript faithfully.',
    'Do not use shell commands, file edits, web access, or any tools from your local Codex runtime.',
    'Reply in plain text unless you need one of the AEGIS functions described in the transcript.',
    'If you need a function, emit exactly one fenced block tagged `tool_call` containing a JSON object with `name` and `arguments`, then stop.',
    'Example:',
    '```tool_call',
    '{"name":"getPortfolio","arguments":{}}',
    '```',
    '',
    'Transcript:',
    formatTranscript(messages),
  ].join('\n');

  return { promptText: rendered, warnings };
}

function normalizeUsage(raw) {
  return {
    inputTokens: raw?.input_tokens ?? raw?.inputTokens ?? undefined,
    outputTokens: raw?.output_tokens ?? raw?.outputTokens ?? undefined,
    totalTokens: raw?.total_tokens ?? raw?.totalTokens ?? undefined,
    reasoningTokens: raw?.reasoning_output_tokens ?? raw?.reasoningTokens ?? undefined,
    cachedInputTokens: raw?.cached_input_tokens ?? raw?.cachedInputTokens ?? undefined,
  };
}

async function copyIfPresent(source, destination) {
  try {
    await copyFile(source, destination);
    return true;
  } catch (err) {
    if (err?.code === 'ENOENT') return false;
    throw err;
  }
}

async function seedCodexHome(codexHome) {
  await mkdir(codexHome, { recursive: true });
  for (const dir of ['sessions', 'tmp', 'cache', 'log']) {
    await mkdir(join(codexHome, dir), { recursive: true });
  }

  const sourceHome = process.env.CODEX_HOME || join(process.env.HOME || '', '.codex');
  if (!sourceHome) return;
  await copyIfPresent(join(sourceHome, 'auth.json'), join(codexHome, 'auth.json'));
  await copyIfPresent(join(sourceHome, 'installation_id'), join(codexHome, 'installation_id'));
  await copyIfPresent(join(sourceHome, 'version.json'), join(codexHome, 'version.json'));
}

async function runCodexExec({ modelId, promptText, abortSignal }) {
  const bin = env.CODEX_BIN || 'codex';
  const workdir = await mkdtemp(join(tmpdir(), 'aegis-codex-'));
  const codexHome = join(workdir, 'codex-home');
  await seedCodexHome(codexHome);
  const args = [
    '-a', 'never',
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox', 'read-only',
    '--cd', workdir,
  ];
  const explicitModel = modelId && modelId !== 'default' ? modelId : null;
  const fallbackModel = env.CODEX_DEFAULT_MODEL || null;
  const selectedModel = explicitModel || fallbackModel;
  if (selectedModel) {
    args.push('-m', selectedModel);
  }
  args.push('-');

  let child;
  try {
    child = spawn(bin, args, {
      cwd: workdir,
      env: { ...process.env, CODEX_HOME: codexHome },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    await rm(workdir, { recursive: true, force: true });
    if (isEnoent(err)) {
      throw new Error(
        `Codex CLI not found (tried "${bin}"). Install it from ` +
        `https://developers.openai.com/codex/cli, run \`codex login\`, then retry. ` +
        `To use a custom path, set CODEX_BIN in your environment.`
      );
    }
    throw err;
  }

  const stdoutChunks = [];
  const stderrChunks = [];
  const assistantParts = [];
  let usage = null;
  let killedForAbort = false;
  let resolved = false;

  const cleanup = async () => {
    await rm(workdir, { recursive: true, force: true });
  };

  const parseLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) return;
    try {
      const event = JSON.parse(trimmed);
      if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
        assistantParts.push(event.item.text);
      } else if (event.type === 'turn.completed') {
        usage = normalizeUsage(event.usage);
      }
    } catch {
      // Best-effort: retain raw output for error reporting, but don't fail on
      // non-JSON chatter from the CLI wrapper.
    }
  };

  const attachLineParser = (stream, sink) => {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      sink.push(chunk);
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        parseLine(line);
      }
    });
    stream.on('end', () => {
      if (buffer) parseLine(buffer);
    });
  };

  attachLineParser(child.stdout, stdoutChunks);
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderrChunks.push(chunk);
    const text = chunk.toString().trim();
    if (text) log.debug({ stream: 'codex-stderr' }, text);
  });

  let abortHandler = null;
  const exitPromise = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });

  if (abortSignal) {
    if (abortSignal.aborted) {
      killedForAbort = true;
      child.kill('SIGTERM');
    } else {
      abortHandler = () => {
        killedForAbort = true;
        child.kill('SIGTERM');
      };
      abortSignal.addEventListener('abort', abortHandler, { once: true });
    }
  }

  child.stdin.end(promptText);

  try {
    const { code, signal } = await exitPromise;
    resolved = true;
    if (killedForAbort || abortSignal?.aborted) {
      const err = Object.assign(new Error('Codex generation aborted'), { code: 'AbortError', name: 'AbortError' });
      throw err;
    }
    if (code !== 0) {
      const stderr = stderrChunks.join('').trim();
      const stdout = stdoutChunks.join('').trim();
      const detail = stderr || stdout || `exit code ${code}${signal ? ` (${signal})` : ''}`;
      throw new Error(`Codex CLI failed: ${detail}`);
    }
    const rawText = assistantParts.join('\n').trim();
    const parsed = parseToolCalls(rawText, { idPrefix: 'codex' });
    return {
      text: parsed.text,
      raw: rawText,
      toolCalls: parsed.toolCalls,
      warnings: [],
      usage,
    };
  } catch (err) {
    if (isEnoent(err)) {
      throw new Error(
        `Codex CLI not found (tried "${bin}"). Install it from ` +
        `https://developers.openai.com/codex/cli and run \`codex login\`.`
      );
    }
    if (isAbortError(err)) {
      const abortErr = Object.assign(new Error('Codex generation aborted'), { code: 'AbortError', name: 'AbortError' });
      throw abortErr;
    }
    throw err;
  } finally {
    if (abortHandler) {
      abortSignal?.removeEventListener('abort', abortHandler);
    }
    if (!resolved && !child.killed) {
      child.kill('SIGTERM');
    }
    await cleanup();
  }
}

export class CodexLanguageModel {
  constructor(modelId, settings = {}, config = {}) {
    this.specificationVersion = 'v2';
    this.provider = config.provider || 'codex';
    this.modelId = modelId;
    this.settings = settings;
    this.supportedUrls = {};
  }

  async _runOnce({ prompt, tools, toolChoice, abortSignal }) {
    const { promptText, warnings } = buildCodexPrompt(prompt, tools, toolChoice);
    const result = await runCodexExec({
      modelId: this.modelId,
      promptText,
      abortSignal,
    });
    return { ...result, warnings: [...warnings, ...(result.warnings || [])] };
  }

  async doGenerate(options) {
    const { prompt, tools, toolChoice, abortSignal } = options;
    const result = await this._runOnce({ prompt, tools, toolChoice, abortSignal });

    const content = [];
    if (result.text) {
      content.push({ type: 'text', text: result.text });
    }
    for (const toolCall of result.toolCalls) {
      content.push({
        type: 'tool-call',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        input: typeof toolCall.arguments === 'string'
          ? toolCall.arguments
          : JSON.stringify(toolCall.arguments ?? {}),
      });
    }

    return {
      content,
      finishReason: result.toolCalls.length > 0 ? 'tool-calls' : 'stop',
      usage: result.usage,
      warnings: result.warnings || [],
      response: { id: `codex-${Date.now()}`, modelId: this.modelId, timestamp: new Date() },
    };
  }

  async doStream(options) {
    const { prompt, tools, toolChoice, abortSignal } = options;
    const stream = new ReadableStream({
      start: async (controller) => {
        const textId = `codex-text-${Date.now()}`;
        const emit = (part) => {
          try { controller.enqueue(part); } catch {}
        };

        try {
          const result = await this._runOnce({ prompt, tools, toolChoice, abortSignal });
          emit({ type: 'stream-start', warnings: result.warnings || [] });

          if (result.text) {
            emit({ type: 'text-start', id: textId });
            emit({ type: 'text-delta', id: textId, delta: result.text });
            emit({ type: 'text-end', id: textId });
          }

          for (const toolCall of result.toolCalls) {
            const inputStr = typeof toolCall.arguments === 'string'
              ? toolCall.arguments
              : JSON.stringify(toolCall.arguments ?? {});
            emit({ type: 'tool-input-start', id: toolCall.id, toolName: toolCall.name });
            emit({ type: 'tool-input-delta', id: toolCall.id, delta: inputStr });
            emit({ type: 'tool-input-end', id: toolCall.id });
            emit({
              type: 'tool-call',
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              input: inputStr,
            });
          }

          emit({
            type: 'finish',
            finishReason: result.toolCalls.length > 0 ? 'tool-calls' : (result.text ? 'stop' : 'other'),
            usage: result.usage,
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

export function createCodex(options = {}) {
  const make = (modelId, settings) => new CodexLanguageModel(modelId, settings || {}, {
    provider: options.providerName || 'codex',
  });

  const provider = (modelId, settings) => make(modelId, settings);
  provider.languageModel = make;
  provider.chat = make;
  provider.textEmbeddingModel = (modelId) => {
    throw new Error(`Codex does not expose embedding models through AEGIS. Asked for "${modelId}".`);
  };
  return provider;
}

export const codex = createCodex();
