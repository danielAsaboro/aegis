/**
 * AI-SDK turn telemetry — records AgentInvocation + AgentToolCall rows
 * AND emits live tool-execution events for chat surfaces to display
 * progress (`→ getSwapQuote`, `✓ 482ms`, ...).
 *
 * The callbacks are passed to agent.generate({ ... }) / agent.stream({ ... })
 * via the `experimental_*` fields the SDK exposes. Every callback body is
 * wrapped in try/catch so a DB failure or schema drift can never break the
 * agent loop.
 *
 * Status values written to AgentInvocation.status:
 *   'running'  — created on experimental_onStart
 *   'finished' — populated on onFinish (default close)
 *   'error'    — populated on onError or markError(err)
 *   'aborted'  — populated on onAbort or markAborted() (Ctrl+C / surface abort)
 */

import { EventEmitter } from 'node:events';
import { getPrisma } from '../db/index.mjs';
import { createLogger } from '../core/logger.mjs';
import { indexToolCall, shouldIndexTool, summarizeToolCall } from '../qvac/indexer.mjs';

const log = createLogger('agent-telemetry');

function safeStringify(value) {
  if (value === undefined) return null;
  try {
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return null;
  }
}

export function createTurnTelemetry({ userId, source, model } = {}) {
  const events = new EventEmitter();
  events.setMaxListeners(50);

  let invocationId = null;
  let invocationStarted = 0;
  const toolCallStarts = new Map(); // toolCallId → { start, toolName, input }

  async function startInvocation() {
    try {
      const row = await getPrisma().agentInvocation.create({
        data: {
          userId: userId ? String(userId) : 'unknown',
          source: source || 'cli',
          model: model || 'unknown',
          status: 'running',
        },
      });
      invocationId = row.id;
      invocationStarted = Date.now();
    } catch (err) {
      log.warn({ err: err.message }, 'failed to create AgentInvocation');
    }
  }

  let finalized = false;

  async function finishInvocation({ usage, steps, error, aborted } = {}) {
    if (!invocationId) return;
    if (finalized) return;
    finalized = true;
    try {
      const status = aborted ? 'aborted' : (error ? 'error' : 'finished');
      await getPrisma().agentInvocation.update({
        where: { id: invocationId },
        data: {
          status,
          inputTokens: usage?.inputTokens ?? usage?.promptTokens ?? null,
          outputTokens: usage?.outputTokens ?? usage?.completionTokens ?? null,
          totalTokens: usage?.totalTokens ?? null,
          steps: typeof steps === 'number' ? steps : (Array.isArray(steps) ? steps.length : null),
          durationMs: Date.now() - invocationStarted,
          error: error ? String(error.message || error) : null,
          finishedAt: new Date(),
        },
      });
    } catch (err) {
      log.warn({ err: err.message, invocationId }, 'failed to update AgentInvocation');
    }
  }

  async function recordToolCall({ toolCallId, toolName, input, output, errorMsg, success, durationMs }) {
    let row = null;
    try {
      row = await getPrisma().agentToolCall.create({
        data: {
          invocationId,
          userId: userId ? String(userId) : 'unknown',
          toolName: toolName || 'unknown',
          toolCallId: toolCallId || `local-${Date.now()}`,
          input: safeStringify(input) ?? '',
          output: safeStringify(output),
          errorMsg: errorMsg ? String(errorMsg) : null,
          success: !!success,
          durationMs: typeof durationMs === 'number' ? durationMs : null,
        },
      });
    } catch (err) {
      log.warn({ err: err.message, toolName }, 'failed to record AgentToolCall');
      return;
    }

    // Best-effort QVAC indexing for state-mutating tools. Failures here
    // never break the agent loop or the DB record.
    if (row && success && shouldIndexTool(toolName)) {
      try {
        const summary = summarizeToolCall({ toolName, input, output, success, errorMsg });
        await indexToolCall(row.id, summary, userId);
      } catch (err) {
        log.warn({ err: err.message, toolName }, 'indexToolCall failed (non-fatal)');
      }
    }
  }

  const callbacks = {
    experimental_onStart: async () => {
      try {
        await startInvocation();
        events.emit('start', { invocationId });
      } catch (err) {
        log.warn({ err: err.message }, 'experimental_onStart handler failed');
      }
    },

    experimental_onStepStart: (step) => {
      try {
        events.emit('step-start', step);
      } catch {}
    },

    experimental_onToolCallStart: (event) => {
      try {
        const toolCallId = event?.toolCallId || event?.toolCall?.toolCallId;
        const toolName = event?.toolName || event?.toolCall?.toolName;
        const input = event?.input ?? event?.args ?? event?.toolCall?.input ?? event?.toolCall?.args;
        if (toolCallId) {
          toolCallStarts.set(toolCallId, { start: Date.now(), toolName, input });
        }
        events.emit('tool-call-start', { toolCallId, toolName, input });
      } catch (err) {
        log.warn({ err: err.message }, 'experimental_onToolCallStart handler failed');
      }
    },

    experimental_onToolCallFinish: async (event) => {
      try {
        const toolCallId = event?.toolCallId || event?.toolCall?.toolCallId;
        const toolName = event?.toolName || event?.toolCall?.toolName;
        const output = event?.output ?? event?.result ?? event?.toolResult?.output;
        const errorMsg = event?.error ? String(event.error.message || event.error) : null;
        const success = !errorMsg;
        const started = toolCallStarts.get(toolCallId);
        const durationMs = started ? Date.now() - started.start : null;
        const input = started?.input ?? event?.input ?? event?.args ?? null;
        toolCallStarts.delete(toolCallId);

        await recordToolCall({
          toolCallId,
          toolName: toolName || started?.toolName,
          input,
          output,
          errorMsg,
          success,
          durationMs,
        });

        events.emit('tool-call-finish', {
          toolCallId,
          toolName: toolName || started?.toolName,
          output,
          errorMsg,
          success,
          durationMs,
        });

        if (!success) {
          events.emit('tool-error', {
            toolCallId,
            toolName: toolName || started?.toolName,
            errorMsg,
            durationMs,
          });
        }
      } catch (err) {
        log.warn({ err: err.message }, 'experimental_onToolCallFinish handler failed');
      }
    },

    onStepFinish: (step) => {
      try {
        events.emit('step-finish', step);
      } catch {}
    },

    onFinish: async (result) => {
      try {
        await finishInvocation({
          usage: result?.totalUsage ?? result?.usage,
          steps: result?.steps,
        });
        events.emit('finish', result);
      } catch (err) {
        log.warn({ err: err.message }, 'onFinish handler failed');
      }
    },

    onError: async (error) => {
      try {
        await finishInvocation({ error });
        events.emit('error', error);
      } catch (err) {
        log.warn({ err: err.message }, 'onError handler failed');
      }
    },

    onAbort: async () => {
      try {
        await finishInvocation({ aborted: true });
        events.emit('abort', { invocationId });
      } catch (err) {
        log.warn({ err: err.message }, 'onAbort handler failed');
      }
    },
  };

  async function markAborted() {
    try {
      await finishInvocation({ aborted: true });
      events.emit('abort', { invocationId });
    } catch (err) {
      log.warn({ err: err.message }, 'markAborted failed');
    }
  }

  async function markError(error) {
    try {
      await finishInvocation({ error });
      events.emit('error', error);
    } catch (err) {
      log.warn({ err: err.message }, 'markError failed');
    }
  }

  return {
    events,
    callbacks,
    getInvocationId: () => invocationId,
    markAborted,
    markError,
  };
}
