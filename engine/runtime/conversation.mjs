/**
 * Shared conversation runner for interactive and scheduled agent turns.
 *
 * Surfaces can reuse this loop instead of each re-implementing approval
 * handling and multi-step resume semantics around runAgentTurn().
 */

import { runAgentTurn, appendHistory } from '../agent/index.mjs';

export function collectPendingApprovals(messages) {
  const requests = [];
  const callsById = new Map();

  for (const msg of messages || []) {
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part.type === 'tool-call') {
        callsById.set(part.toolCallId, { name: part.toolName, args: part.input ?? part.args });
      } else if (part.type === 'tool-approval-request') {
        const call = callsById.get(part.toolCallId) || {};
        requests.push({
          approvalId: part.approvalId,
          toolCallId: part.toolCallId,
          toolName: call.name || 'tool',
          args: call.args,
        });
      }
    }
  }

  return requests;
}

function normalizeApprovalResponses(approvals, decisions) {
  if (!Array.isArray(decisions) || decisions.length !== approvals.length) {
    throw new Error('requestApprovals must return one decision per pending approval');
  }
  return approvals.map((approval, idx) => ({
    type: 'tool-approval-response',
    approvalId: approval.approvalId,
    approved: decisions[idx] === true,
  }));
}

export async function runConversationUntilStable({
  userId,
  chatId,
  source = 'cli',
  walletName,
  prompt,
  resumeMessages,
  turnProfile = 'interactive',
  skipBudget = false,
  abortSignal,
  onEvents,
  onText,
  requestApprovals,
} = {}) {
  let messages = resumeMessages;
  let pendingPrompt = prompt;

  while (true) {
    const result = await runAgentTurn({
      userId,
      chatId,
      source,
      walletName,
      prompt: messages ? undefined : pendingPrompt,
      messages,
      skipBudget,
      abortSignal,
      turnProfile,
      onEvents,
    });

    pendingPrompt = undefined;
    messages = undefined;

    if (typeof onText === 'function' && result?.text) {
      await onText(result.text, result);
    }

    const approvals = collectPendingApprovals(result.response?.messages);
    if (approvals.length === 0) return result;
    if (typeof requestApprovals !== 'function') {
      throw new Error('Pending tool approvals require a requestApprovals handler');
    }

    const decisions = await requestApprovals(approvals, result);
    const responses = normalizeApprovalResponses(approvals, decisions);
    await appendHistory(
      userId,
      [{ role: 'tool', content: responses }],
      { source, chatId, metadata: { turnProfile, approvalCount: approvals.length } },
    );
  }
}
