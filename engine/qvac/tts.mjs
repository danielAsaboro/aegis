/**
 * Text-to-speech adapter — routes synthesis through the QVAC sidecar's
 * ONNX TTS wrapper. The sidecar emits raw 16-bit PCM samples + sample rate;
 * we encode to OGG/Opus on the Node side so the result is directly
 * pluggable into Telegram's `replyWithVoice`.
 */

import { basename } from 'node:path';
import env from '../config.mjs';
import { createLogger } from '../core/logger.mjs';
import { QvacUnavailableError, assertModelDir } from './index.mjs';
import { pcmToOggOpus } from './audio.mjs';
import { getSidecar } from './sidecar/client.mjs';

const log = createLogger('qvac-tts');

export async function createTTS() {
  const modelDir = env.QVAC_TTS_MODEL_DIR;
  assertModelDir('tts', modelDir);

  const sidecar = getSidecar();
  // Warm-load by synthesizing a single token; result is discarded.
  try {
    await sidecar.request('tts', {
      modelDir,
      voiceName: env.QVAC_TTS_VOICE,
      language: env.QVAC_TTS_LANGUAGE,
      text: '.',
    });
  } catch (err) {
    if (err.code === 'qvac_sidecar_unavailable') {
      throw new QvacUnavailableError('tts', err.reason || err.message);
    }
    throw new QvacUnavailableError('tts', err.message || String(err));
  }

  log.info({ model: basename(modelDir), voice: env.QVAC_TTS_VOICE }, 'QVAC TTS warm');

  async function synthesize(text, _opts = {}) {
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error('synthesize(): text must be a non-empty string');
    }
    const result = await sidecar.request('tts', {
      modelDir,
      voiceName: env.QVAC_TTS_VOICE,
      language: env.QVAC_TTS_LANGUAGE,
      text,
    });
    if (!result?.pcmBase64) {
      throw new Error('synthesize(): sidecar returned no PCM data');
    }
    const pcm = Buffer.from(result.pcmBase64, 'base64');
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
    const ogg = await pcmToOggOpus(samples, result.sampleRate || 24_000);
    return { buffer: ogg, sampleRate: result.sampleRate || 24_000, durationSec: result.durationSec || 0 };
  }

  async function unload() {
    try { await sidecar.request('unload', { target: 'tts' }); }
    catch (err) { log.warn({ err: err.message }, 'TTS unload failed'); }
  }

  return { synthesize, unload };
}
