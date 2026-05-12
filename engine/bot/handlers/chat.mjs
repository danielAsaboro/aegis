/**
 * Telegram chat surface for the AEGIS LLM agent.
 *
 * Routes non-slash text to runAgentTurn(). Adds three slash commands:
 *   /agent model <id>   — switch the active model (gpt-5, claude-sonnet-4.5, ...)
 *   /agent reset        — clear this user's chat history
 *   /agent autonomy <off|advisory|autonomous>  — change autonomy mode (per-chat)
 *
 * Live progress: a single `🤔 thinking...` message is edited in place as
 * tool calls fire. Edits are throttled to ≥ 1500 ms per chat to avoid
 * Telegram 429s; events that arrive inside the throttle window are
 * coalesced and rendered in the next allowed edit.
 */

import { Markup } from 'telegraf';
import {
  runAgentTurn,
  setActiveModel,
  getActiveModel,
  getAvailableModels,
  clearHistory,
  getHistory,
  appendHistory,
  listSkills,
  refreshSkills,
} from '../../agent/index.mjs';
import { collectPendingApprovals } from '../../runtime/conversation.mjs';
import { botLog } from '../../core/logger.mjs';
import env from '../../config.mjs';
import { getPrisma } from '../../db/index.mjs';

async function setVoicePref(chatId, patch) {
  const id = String(chatId);
  return getPrisma().voicePreference.upsert({
    where: { chatId: id },
    update: { ...patch },
    create: { chatId: id, ...patch },
  });
}

const _autonomyByChat = new Map(); // chatId → 'off'|'advisory'|'autonomous'
const _pendingApprovals = new Map();

const EDIT_THROTTLE_MS = 1500;

let _pendingCounter = 0;
function nextPendingId() {
  return `apr-${Date.now()}-${++_pendingCounter}`;
}

function formatApprovalPrompt(req) {
  const argsLine = req.args ? '\n```\n' + JSON.stringify(req.args, null, 2) + '\n```' : '';
  return `🤖 *Approval required*\n\nThe agent wants to call \`${req.toolName}\`:${argsLine}`;
}

function approvalKeyboard(pendingId, approvalId) {
  return Markup.inlineKeyboard([
    Markup.button.callback('✅ Approve', `agent_approve_${pendingId}_${approvalId}`),
    Markup.button.callback('❌ Deny', `agent_deny_${pendingId}_${approvalId}`),
  ]);
}

async function sendApprovalPrompts(ctx, pendingId, approvals) {
  for (const req of approvals) {
    await ctx.replyWithMarkdown(
      formatApprovalPrompt(req),
      approvalKeyboard(pendingId, req.approvalId)
    );
  }
}

async function buildFullMessages(userId, prompt, extraMessages = []) {
  const history = await getHistory(userId);
  const out = history.map(({ role, content }) => ({ role, content }));
  if (prompt) out.push({ role: 'user', content: prompt });
  out.push(...extraMessages);
  return out;
}

/**
 * Subscribe to telemetry events on a turn and edit a single Telegram message
 * in place to surface live progress. Returns a teardown function.
 */
function attachLiveProgress({ ctx, events, thinkingMsg }) {
  if (!events || !thinkingMsg) return () => {};

  const lines = ['🤔 thinking...'];
  const callsByToolId = new Map(); // toolCallId → { idx, name }
  let lastEditAt = 0;
  let pendingTimer = null;
  let stopped = false;

  function render() {
    return lines.join('\n');
  }

  async function flush() {
    if (stopped) return;
    pendingTimer = null;
    lastEditAt = Date.now();
    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        thinkingMsg.message_id,
        undefined,
        render(),
      );
    } catch (err) {
      // Ignore "message is not modified" or 429s; live updates are best-effort.
    }
  }

  function schedule() {
    if (stopped) return;
    if (pendingTimer) return;
    const since = Date.now() - lastEditAt;
    const delay = since >= EDIT_THROTTLE_MS ? 0 : EDIT_THROTTLE_MS - since;
    pendingTimer = setTimeout(flush, delay);
  }

  events.on('tool-call-start', ({ toolCallId, toolName }) => {
    if (!toolName) return;
    const idx = lines.length;
    lines.push(`→ ${toolName}`);
    callsByToolId.set(toolCallId, { idx, name: toolName });
    schedule();
  });

  events.on('tool-call-finish', ({ toolCallId, toolName, success, errorMsg, durationMs }) => {
    const entry = callsByToolId.get(toolCallId);
    const name = entry?.name || toolName || 'tool';
    const dur = durationMs != null ? ` ${durationMs}ms` : '';
    const mark = success ? `✓ ${name}${dur}` : `✗ ${name}${errorMsg ? ` — ${errorMsg}` : ''}`;
    if (entry) {
      lines[entry.idx] = mark;
    } else {
      lines.push(mark);
    }
    schedule();
  });

  events.on('tool-error', ({ toolCallId, toolName, errorMsg }) => {
    const entry = callsByToolId.get(toolCallId);
    const name = entry?.name || toolName || 'tool';
    const mark = `✗ ${name}${errorMsg ? ` — ${errorMsg}` : ''}`;
    if (entry) {
      lines[entry.idx] = mark;
    } else {
      lines.push(mark);
    }
    schedule();
  });

  events.on('abort', () => {
    lines.push('⏹ aborted');
    schedule();
  });

  return () => {
    stopped = true;
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  };
}

function renderTypedError(err) {
  if (!err) return 'Unknown error.';
  if (err.code === 'AbortError' || err.name === 'AbortError') {
    return null; // silent — user-initiated cancel
  }
  if (err.code === 'budget_exhausted') {
    const next = new Date(Date.now() + 60 * 60 * 1000);
    const hh = String(next.getHours()).padStart(2, '0');
    const mm = String(next.getMinutes()).padStart(2, '0');
    return `Hourly agent budget reached — try again at ${hh}:${mm}.`;
  }
  if (err.code === 'no_policy_result') {
    return 'Trade refused: no policy gate ran. This is a wiring bug — the proposal must go through runPolicies() before execution.';
  }
  if (err.code === 'missing_policy_config') {
    return `Trade refused: ${err.message}`;
  }
  return `Error: ${err.message || String(err)}`;
}

export async function runUntilStableOrApproval({ ctx, userId, walletName, prompt, resumeMessages, thinkingMsg }) {
  let detach = () => {};

  const result = await runAgentTurn({
    userId,
    chatId: ctx.chat?.id,
    source: 'telegram',
    walletName,
    prompt: resumeMessages ? undefined : prompt,
    messages: resumeMessages,
    turnProfile: 'interactive',
    onEvents: (events) => {
      detach = attachLiveProgress({ ctx, events, thinkingMsg });
    },
  });

  detach();

  const newMessages = result.response?.messages || [];
  const pending = collectPendingApprovals(newMessages);

  if (pending.length === 0) {
    if (thinkingMsg) {
      try { await ctx.deleteMessage(thinkingMsg.message_id); } catch {}
    }
    if (result.text) await ctx.reply(result.text);
    return { done: true, result };
  }

  // Build the full messages array we'll resume from later.
  const fullMessages = resumeMessages
    ? [...resumeMessages, ...newMessages]
    : [...(await buildFullMessages(userId, prompt)), ...newMessages];

  const pendingId = nextPendingId();
  _pendingApprovals.set(pendingId, {
    messages: fullMessages,
    approvals: pending,
    responses: new Map(),
    chatId: ctx.chat?.id,
    userId,
    walletName,
  });

  if (thinkingMsg) {
    try { await ctx.deleteMessage(thinkingMsg.message_id); } catch {}
  }
  if (result.text) await ctx.reply(result.text);
  await sendApprovalPrompts(ctx, pendingId, pending);

  return { done: false, pendingId, pending };
}

export function registerChat(bot, config) {
  bot.command('agent', async (ctx) => {
    const args = (ctx.message?.text || '').split(/\s+/).slice(1);
    const sub = (args[0] || '').toLowerCase();

    if (!sub || sub === 'help' || sub === 'status') {
      const autonomy = _autonomyByChat.get(ctx.chat.id) || env.AEGIS_AGENT_AUTONOMY;
      await ctx.replyWithMarkdown(
        `*AEGIS Agent*\n` +
        `Active model: \`${getActiveModel()}\`\n` +
        `Autonomy (this chat): \`${autonomy}\`\n\n` +
        `Subcommands:\n` +
        `\`/agent model <id>\` — switch model\n` +
        `\`/agent reset\` — clear chat history\n` +
        `\`/agent autonomy <off|advisory|autonomous>\` — set autonomy\n` +
        `\`/agent skills\` — list discovered Agent Skills\n` +
        `\`/agent skills refresh\` — re-scan skill directories\n` +
        `\`/agent voice on|off\` — toggle TTS read-back (QVAC, on-device)\n` +
        `\`/agent voice <name>\` — pick ONNX TTS voice\n` +
        `\`/agent voice language <code>\` — set BCP-47 language for STT\n\n` +
        `Available models: ${getAvailableModels().map(m => '`' + m + '`').join(', ')}`
      );
      return;
    }

    if (sub === 'model') {
      const id = args[1];
      if (!id) {
        await ctx.reply(`Active model: ${getActiveModel()}\nAvailable: ${getAvailableModels().join(', ')}`);
        return;
      }
      try {
        setActiveModel(id);
        await ctx.reply(`Active model switched to ${id}.`);
      } catch (err) {
        await ctx.reply(`${err.message}`);
      }
      return;
    }

    if (sub === 'reset') {
      await clearHistory(ctx.from.id);
      await ctx.reply('Chat history cleared.');
      return;
    }

    if (sub === 'autonomy') {
      const mode = (args[1] || '').toLowerCase();
      if (!['off', 'advisory', 'autonomous'].includes(mode)) {
        await ctx.reply('Usage: /agent autonomy <off|advisory|autonomous>');
        return;
      }
      _autonomyByChat.set(ctx.chat.id, mode);
      await ctx.reply(`Autonomy for this chat set to \`${mode}\`.`, { parse_mode: 'Markdown' });
      return;
    }

    if (sub === 'skills') {
      const action = (args[1] || '').toLowerCase();
      if (action === 'refresh' || action === 'reload') {
        const skills = refreshSkills();
        await ctx.reply(`Reloaded ${skills.length} skill${skills.length === 1 ? '' : 's'} from disk.`);
        return;
      }
      const skills = listSkills();
      if (skills.length === 0) {
        await ctx.replyWithMarkdown(
          `*Agent Skills*\nNo skills found.\n\n` +
          `Drop a folder with a SKILL.md into \`.agents/skills/\` (project) or ` +
          `\`~/.config/aegis/skills/\` (user) and run \`/agent skills refresh\`.`
        );
        return;
      }
      const lines = ['*Agent Skills*'];
      for (const s of skills) {
        lines.push(`• \`${s.name}\` — ${s.description.length > 140 ? s.description.slice(0, 137) + '…' : s.description}`);
      }
      lines.push('');
      lines.push(`Use \`/agent skills refresh\` to re-scan disk.`);
      await ctx.replyWithMarkdown(lines.join('\n'));
      return;
    }

    if (sub === 'voice') {
      const action = (args[1] || '').toLowerCase();
      if (action === 'on' || action === 'off') {
        const enabled = action === 'on';
        await setVoicePref(ctx.chat.id, { ttsEnabled: enabled });
        await ctx.reply(`Voice read-back ${enabled ? 'enabled' : 'disabled'} for this chat.`);
        return;
      }
      if (action === 'language' || action === 'lang') {
        const lang = args[2];
        if (!lang) {
          await ctx.reply('Usage: /agent voice language <BCP-47>  e.g. /agent voice language en-US');
          return;
        }
        await setVoicePref(ctx.chat.id, { language: lang });
        await ctx.reply(`Voice language set to \`${lang}\`.`, { parse_mode: 'Markdown' });
        return;
      }
      if (!action || action === 'status') {
        const pref = await getPrisma().voicePreference.findUnique({ where: { chatId: String(ctx.chat.id) } }).catch(() => null);
        await ctx.replyWithMarkdown(
          `*Voice (this chat)*\n` +
          `TTS read-back: \`${pref?.ttsEnabled ? 'on' : 'off'}\`\n` +
          (pref?.voice ? `Voice: \`${pref.voice}\`\n` : '') +
          (pref?.language ? `Language: \`${pref.language}\`\n` : '') +
          `\nUse \`/agent voice on|off\` to toggle, \`/agent voice <name>\` to set the ONNX voice, ` +
          `\`/agent voice language <code>\` to set language.`
        );
        return;
      }
      // Anything else is treated as an ONNX voice name.
      await setVoicePref(ctx.chat.id, { voice: action });
      await ctx.reply(`ONNX voice set to \`${action}\`.`, { parse_mode: 'Markdown' });
      return;
    }

    await ctx.reply(`Unknown /agent subcommand: ${sub}`);
  });

  bot.on('message', async (ctx, next) => {
    const text = ctx.message?.text;
    if (!text || text.startsWith('/')) {
      if (next) return next();
      return;
    }

    const userId = ctx.from.id;
    const walletName = config.walletName;

    let thinkingMsg;
    try {
      thinkingMsg = await ctx.reply('🤔 thinking...');
    } catch {}

    try {
      const { done, pending } = await runUntilStableOrApproval({
        ctx,
        userId,
        walletName,
        prompt: text,
        thinkingMsg,
      });

      if (!done) {
        botLog.info({ userId, pendingApprovals: pending.length }, 'Agent paused for approval');
      }
    } catch (err) {
      botLog.error({ err: err.message, code: err.code, userId }, 'Agent turn failed');
      const friendly = renderTypedError(err);
      if (friendly === null) {
        // silent abort
        if (thinkingMsg) {
          try { await ctx.deleteMessage(thinkingMsg.message_id); } catch {}
        }
        return;
      }
      if (thinkingMsg) {
        try { await ctx.telegram.editMessageText(ctx.chat.id, thinkingMsg.message_id, undefined, friendly); } catch {}
      } else {
        await ctx.reply(friendly);
      }
    }
  });

  bot.action(/^agent_(approve|deny)_([^_]+)_(.+)$/, async (ctx) => {
    const decision = ctx.match[1];
    const pendingId = ctx.match[2];
    const approvalId = ctx.match[3];

    const pending = _pendingApprovals.get(pendingId);
    if (!pending) {
      await ctx.answerCbQuery('This approval request expired.');
      try { await ctx.editMessageText('⚠️ This approval request expired.'); } catch {}
      return;
    }

    pending.responses.set(approvalId, decision === 'approve');
    await ctx.answerCbQuery(decision === 'approve' ? 'Approved' : 'Denied');
    try {
      await ctx.editMessageText(
        decision === 'approve' ? '✅ Approved.' : '❌ Denied.',
      );
    } catch {}

    if (pending.responses.size < pending.approvals.length) return;

    const toolContent = pending.approvals.map(req => ({
      type: 'tool-approval-response',
      approvalId: req.approvalId,
      approved: pending.responses.get(req.approvalId) === true,
    }));

    const toolResponseMsg = { role: 'tool', content: toolContent };
    const messagesWithResponses = [...pending.messages, toolResponseMsg];

    _pendingApprovals.delete(pendingId);

    await appendHistory(pending.userId, [toolResponseMsg], {
      source: 'telegram',
      chatId: pending.chatId,
      metadata: { turnProfile: 'interactive', resumed: true },
    });

    try {
      const resumingMsg = await ctx.reply('▶️ resuming...');
      await runUntilStableOrApproval({
        ctx,
        userId: pending.userId,
        walletName: pending.walletName,
        resumeMessages: messagesWithResponses,
        thinkingMsg: resumingMsg,
      });
    } catch (err) {
      botLog.error({ err: err.message, code: err.code, pendingId }, 'Agent resume failed');
      const friendly = renderTypedError(err);
      if (friendly !== null) {
        await ctx.reply(friendly);
      }
    }
  });
}

export function getChatAutonomy(chatId) {
  return _autonomyByChat.get(chatId) || env.AEGIS_AGENT_AUTONOMY;
}
