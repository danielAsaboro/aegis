/**
 * Transcription adapter — routes audio buffers through the QVAC sidecar's
 * whisper.cpp wrapper.
 *
 * Public API:
 *   const t = await createTranscriber();
 *   const { text, segments } = await t.transcribe(audioBuffer, { language });
 *   await t.unload();
 *
 * Audio is transcoded to 16 kHz mono WAV in the Node host (via ffmpeg-static)
 * so we hand the sidecar a deterministic, model-friendly format every time.
 * The sidecar writes the WAV to a tmp file and feeds whisper a real file
 * stream — matches the documented usage exactly.
 */

import { basename } from 'node:path';
import env from '../config.mjs';
import { createLogger } from '../core/logger.mjs';
import { QvacUnavailableError, assertModelFile } from './index.mjs';
import { transcodeToWav16k } from './audio.mjs';
import { getSidecar } from './sidecar/client.mjs';

const log = createLogger('qvac-stt');

export async function createTranscriber() {
  const modelPath = env.QVAC_WHISPER_MODEL_PATH;
  assertModelFile('transcription', modelPath);
  if (env.QVAC_WHISPER_VAD_MODEL_PATH) {
    assertModelFile('transcription-vad', env.QVAC_WHISPER_VAD_MODEL_PATH);
  }

  const sidecar = getSidecar();
  // Warm-load the model with a 1-frame silent WAV so the first user voice
  // note doesn't pay the load cost.
  const silentWav = makeSilenceWav16k(0.05);
  try {
    await sidecar.request('transcribe', {
      modelPath,
      vadModelPath: env.QVAC_WHISPER_VAD_MODEL_PATH || null,
      useGpu: env.QVAC_WHISPER_USE_GPU,
      language: 'en',
      audioBase64: silentWav.toString('base64'),
    });
  } catch (err) {
    if (err.code === 'qvac_sidecar_unavailable') {
      throw new QvacUnavailableError('transcription', err.reason || err.message);
    }
    throw new QvacUnavailableError('transcription', err.message || String(err));
  }

  log.info({ model: basename(modelPath), gpu: env.QVAC_WHISPER_USE_GPU }, 'QVAC transcriber warm');

  async function transcribe(inputBuffer, opts = {}) {
    if (!Buffer.isBuffer(inputBuffer) || inputBuffer.length === 0) {
      throw new Error('transcribe(): inputBuffer must be a non-empty Buffer');
    }
    const wav = await transcodeToWav16k(inputBuffer);
    const result = await sidecar.request('transcribe', {
      modelPath,
      vadModelPath: env.QVAC_WHISPER_VAD_MODEL_PATH || null,
      useGpu: env.QVAC_WHISPER_USE_GPU,
      language: opts.language || 'en',
      audioBase64: wav.toString('base64'),
    });
    return {
      text: result?.text || '',
      segments: result?.segments || [],
      language: result?.language || opts.language || 'en',
    };
  }

  async function unload() {
    try { await sidecar.request('unload', { target: 'whisper' }); }
    catch (err) { log.warn({ err: err.message }, 'transcriber unload failed'); }
  }

  return { transcribe, unload };
}

/**
 * Build a small silent WAV (mono, 16 kHz, 16-bit PCM) for warm-up.
 * Real bytes — no shims; whisper accepts this verbatim.
 */
function makeSilenceWav16k(seconds = 0.05) {
  const sr = 16_000;
  const n = Math.max(1, Math.round(sr * seconds));
  const dataLen = n * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);          // PCM
  buf.writeUInt16LE(1, 22);          // mono
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);          // block align
  buf.writeUInt16LE(16, 34);         // bits/sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  // PCM samples already zero — that's silence.
  return buf;
}
