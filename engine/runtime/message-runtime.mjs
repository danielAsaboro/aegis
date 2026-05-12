/**
 * In-process queued runtime for agent messages.
 *
 * Interactive surfaces and scheduled jobs enqueue the same envelope shape.
 * Delivery and approval handling are delegated to adapter callbacks.
 */

import { createLogger } from '../core/logger.mjs';
import { runConversationUntilStable } from './conversation.mjs';

const log = createLogger('message-runtime');

let _counter = 0;

function nextMessageId() {
  return `msg-${Date.now()}-${++_counter}`;
}

export function createMessageRuntime({
  walletName,
  deliveryHandlers = {},
  approvalHandlers = {},
} = {}) {
  const queue = [];
  let running = false;
  let stopped = false;

  async function deliver(envelope, payload) {
    const type = envelope.delivery?.type || 'default';
    const handler = deliveryHandlers[type] || deliveryHandlers.default;
    if (typeof handler !== 'function') return;
    await handler({ envelope, ...payload });
  }

  async function requestApprovals(envelope, approvals, result) {
    const type = envelope.delivery?.type || 'default';
    const handler = approvalHandlers[type] || approvalHandlers.default;
    if (typeof handler !== 'function') return approvals.map(() => false);
    return handler({ envelope, approvals, result });
  }

  async function processEnvelope(envelope) {
    await runConversationUntilStable({
      userId: envelope.userId,
      chatId: envelope.chatId,
      source: envelope.source,
      walletName: envelope.walletName || walletName,
      prompt: envelope.prompt,
      resumeMessages: envelope.messages,
      turnProfile: envelope.turnProfile || 'interactive',
      skipBudget: envelope.skipBudget === true,
      onEvents: (events) => {
        if (typeof envelope.onEvents === 'function') envelope.onEvents(events);
        events.on('tool-call-start', ({ toolName, input }) => {
          deliver(envelope, { type: 'tool_start', toolName, input: input ?? null }).catch(() => {});
        });
        events.on('tool-call-finish', ({ toolName, success, durationMs, output }) => {
          let resultPreview = null;
          if (success && output != null) {
            try {
              const s = typeof output === 'string' ? output : JSON.stringify(output);
              if (s && s.length <= 200) resultPreview = s;
            } catch { /* ignore */ }
          }
          deliver(envelope, {
            type: 'tool_finish',
            toolName,
            success: !!success,
            durationMs: durationMs ?? null,
            resultPreview,
          }).catch(() => {});
        });
        events.on('tool-error', ({ toolName, errorMsg }) => {
          deliver(envelope, { type: 'tool_error', toolName, errorMsg: errorMsg ?? '' }).catch(() => {});
        });
      },
      onText: async (text) => {
        const trimmed = String(text || '').trim();
        if (!trimmed || trimmed === 'NO_UPDATE') return;
        await deliver(envelope, { type: 'response', text: trimmed });
      },
      requestApprovals: async (approvals, result) => requestApprovals(envelope, approvals, result),
    });
  }

  async function pump() {
    if (running || stopped) return;
    running = true;
    while (queue.length > 0 && !stopped) {
      const job = queue.shift();
      try {
        await processEnvelope(job.envelope);
        job.resolve(job.envelope.messageId);
      } catch (err) {
        log.warn({ err: err.message, messageId: job.envelope.messageId, source: job.envelope.source }, 'message processing failed');
        job.reject(err);
      }
    }
    running = false;
  }

  return {
    enqueueMessage(envelope) {
      if (stopped) throw new Error('message runtime stopped');
      const message = {
        messageId: envelope.messageId || nextMessageId(),
        source: envelope.source || 'cli',
        turnProfile: envelope.turnProfile || 'interactive',
        ...envelope,
      };
      return new Promise((resolve, reject) => {
        queue.push({ envelope: message, resolve, reject });
        void pump();
      });
    },
    stop() {
      stopped = true;
    },
    getQueueDepth() {
      return queue.length + (running ? 1 : 0);
    },
  };
}
