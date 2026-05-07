/**
 * Telegram voice handler — accepts voice notes and audio messages,
 * transcribes them locally via QVAC whisper.cpp, then routes the
 * transcript through the same agent pipeline as text messages.
 *
 * Why a parallel handler: Telegraf delivers voice notes as `ctx.message.voice`
 * (OGG/Opus) or `ctx.message.audio` (any container). Text agent code can't
 * process those — we need to fetch the file, transcode to PCM, and feed
 * `runUntilStableOrApproval` the resulting transcript.
 *
 * Read-back: if VoicePreference.ttsEnabled is true for this chat, we
 * synthesize an OGG/Opus reply via QVAC TTS and ship it after the text
 * reply (text always lands first — accessibility + fallback if TTS fails).
 *
 * Approval gating: voice trades flow through the same approval keyboard
 * as text trades (see chat.mjs); voice is just an alternative input.
 */

import env from '../../config.mjs';
import { botLog } from '../../core/logger.mjs';
import { getTranscriber, getTTS, QvacUnavailableError } from '../../qvac/index.mjs';
import { getPrisma } from '../../db/index.mjs';
import { runUntilStableOrApproval } from './chat.mjs';

const SUPPORTED_MIME = /^audio\//i;

async function downloadTelegramFile(ctx, fileId) {
  const link = await ctx.telegram.getFileLink(fileId);
  const url = typeof link === 'string' ? link : link.href;
  if (typeof globalThis.fetch !== 'function') {
    throw new Error('Global fetch is unavailable — Node.js >= 18 is required.');
  }
  const res = await globalThis.fetch(url);
  if (!res.ok) {
    throw new Error(`Telegram file download failed: HTTP ${res.status}`);
  }
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

function pickAudioFile(message) {
  if (message?.voice) {
    return { fileId: message.voice.file_id, kind: 'voice', duration: message.voice.duration, mime: message.voice.mime_type };
  }
  if (message?.audio) {
    return { fileId: message.audio.file_id, kind: 'audio', duration: message.audio.duration, mime: message.audio.mime_type };
  }
  if (message?.video_note) {
    return { fileId: message.video_note.file_id, kind: 'video_note', duration: message.video_note.duration, mime: 'video/mp4' };
  }
  return null;
}

async function getVoicePref(chatId) {
  if (!chatId) return null;
  try {
    return await getPrisma().voicePreference.findUnique({ where: { chatId: String(chatId) } });
  } catch (err) {
    botLog.warn({ err: err.message, chatId }, 'voice pref lookup failed');
    return null;
  }
}

async function speakReply(ctx, text) {
  if (!text || !text.trim()) return;
  let tts;
  try {
    tts = await getTTS();
  } catch (err) {
    if (err instanceof QvacUnavailableError) {
      botLog.warn({ reason: err.reason }, 'TTS unavailable — text-only reply');
      return;
    }
    throw err;
  }
  try {
    const { buffer } = await tts.synthesize(text);
    await ctx.replyWithVoice({ source: buffer });
  } catch (err) {
    botLog.warn({ err: err.message }, 'TTS reply failed — text was already sent');
  }
}

export function registerVoice(bot, config) {
  bot.on(['voice', 'audio', 'video_note'], async (ctx) => {
    if (!env.QVAC_ENABLE_VOICE) {
      await ctx.reply('🔇 Voice support is disabled. Set QVAC_ENABLE_VOICE=true and configure QVAC_WHISPER_MODEL_PATH to enable.');
      return;
    }

    const picked = pickAudioFile(ctx.message);
    if (!picked) return;
    if (picked.mime && !SUPPORTED_MIME.test(picked.mime) && picked.kind !== 'video_note') {
      await ctx.reply(`Unsupported audio mime type: ${picked.mime}`);
      return;
    }

    const userId = ctx.from.id;
    const walletName = config.walletName;
    let confirmMsg;

    try {
      let buffer;
      try {
        buffer = await downloadTelegramFile(ctx, picked.fileId);
      } catch (err) {
        await ctx.reply(`Couldn't fetch the audio file: ${err.message}`);
        return;
      }

      let transcriber;
      try {
        transcriber = await getTranscriber();
      } catch (err) {
        if (err instanceof QvacUnavailableError) {
          await ctx.reply(
            `🎙️ QVAC transcription unavailable: ${err.reason}\n\n` +
            `Set QVAC_WHISPER_MODEL_PATH and run \`pnpm qvac:download\` to install the model.`
          );
          return;
        }
        throw err;
      }

      const startedAt = Date.now();
      let transcript;
      try {
        transcript = await transcriber.transcribe(buffer, {});
      } catch (err) {
        await ctx.reply(`🎙️ Transcription failed: ${err.message}`);
        return;
      }
      const ms = Date.now() - startedAt;

      const text = transcript.text.trim();
      if (!text) {
        await ctx.reply('🎙️ No speech detected in that clip.');
        return;
      }

      try {
        confirmMsg = await ctx.reply(`🎙️ heard (${ms}ms): "${text}"`);
      } catch {}

      const thinkingMsg = await ctx.reply('🤔 thinking...').catch(() => null);

      const result = await runUntilStableOrApproval({
        ctx,
        userId,
        walletName,
        prompt: text,
        thinkingMsg,
      });

      // TTS read-back if the user opted in.
      if (result?.done) {
        const pref = await getVoicePref(ctx.chat.id);
        if (pref?.ttsEnabled && result.result?.text) {
          await speakReply(ctx, result.result.text);
        }
      }
    } catch (err) {
      botLog.error({ err: err.message, userId }, 'voice handler failed');
      await ctx.reply(`Error: ${err.message}`).catch(() => {});
    }
  });
}
