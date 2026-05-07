/**
 * Audio utilities — Telegram delivers voice notes as OGG/Opus, but
 * @qvac/transcription-whispercpp accepts raw WAV/PCM most reliably.
 *
 * `transcodeOggToWav(buffer)` shells out to ffmpeg (ffmpeg-static binary by
 * default) to convert to 16 kHz mono PCM WAV — whisper's native input rate.
 * No mocks: if ffmpeg-static is missing, we throw and the caller surfaces
 * the error to the user.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import env from '../config.mjs';

const require_ = createRequire(import.meta.url);

let _ffmpegPath = null;

function resolveFfmpeg() {
  if (_ffmpegPath !== null) return _ffmpegPath;
  if (env.QVAC_FFMPEG_PATH) {
    _ffmpegPath = env.QVAC_FFMPEG_PATH;
    return _ffmpegPath;
  }
  try {
    const ffmpegStatic = require_('ffmpeg-static');
    _ffmpegPath = typeof ffmpegStatic === 'string' ? ffmpegStatic : (ffmpegStatic?.default || null);
  } catch {
    _ffmpegPath = null;
  }
  return _ffmpegPath;
}

export function getFfmpegPath() {
  return resolveFfmpeg();
}

/**
 * Convert any audio buffer (OGG/Opus, MP3, m4a, ...) to 16-bit 16kHz mono WAV.
 * Returns a Buffer with WAV-formatted bytes.
 */
export async function transcodeToWav16k(inputBuffer) {
  if (!Buffer.isBuffer(inputBuffer) || inputBuffer.length === 0) {
    throw new Error('transcodeToWav16k: input must be a non-empty Buffer');
  }
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) {
    throw new Error(
      'ffmpeg binary not found — install ffmpeg-static (`npm i ffmpeg-static`) ' +
      'or set QVAC_FFMPEG_PATH to a system ffmpeg.'
    );
  }

  const dir = mkdtempSync(join(tmpdir(), 'aegis-qvac-'));
  const inPath = join(dir, 'in.bin');
  const outPath = join(dir, 'out.wav');
  writeFileSync(inPath, inputBuffer);

  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpeg, [
        '-hide_banner',
        '-loglevel', 'error',
        '-y',
        '-i', inPath,
        '-ac', '1',
        '-ar', '16000',
        '-c:a', 'pcm_s16le',
        '-f', 'wav',
        outPath,
      ]);
      let stderr = '';
      proc.stderr.on('data', (b) => { stderr += b.toString(); });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited ${code}: ${stderr.trim()}`));
      });
    });
    return readFileSync(outPath);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * Encode 16-bit PCM samples (Int16Array) at sampleRate Hz into an OGG/Opus
 * Buffer suitable for Telegram's `replyWithVoice`. We use ffmpeg with raw
 * s16le input → libopus output.
 */
export async function pcmToOggOpus(int16Samples, sampleRate) {
  if (!int16Samples || typeof int16Samples.length !== 'number') {
    throw new Error('pcmToOggOpus: samples must be Int16Array-like');
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error('pcmToOggOpus: sampleRate must be a positive number');
  }
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) {
    throw new Error('ffmpeg binary not found — install ffmpeg-static or set QVAC_FFMPEG_PATH.');
  }

  const dir = mkdtempSync(join(tmpdir(), 'aegis-qvac-'));
  const inPath = join(dir, 'in.pcm');
  const outPath = join(dir, 'out.ogg');

  // Normalise to a Buffer of little-endian s16
  const view = int16Samples instanceof Int16Array
    ? Buffer.from(int16Samples.buffer, int16Samples.byteOffset, int16Samples.byteLength)
    : Buffer.from(Int16Array.from(int16Samples).buffer);
  writeFileSync(inPath, view);

  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpeg, [
        '-hide_banner',
        '-loglevel', 'error',
        '-y',
        '-f', 's16le',
        '-ar', String(sampleRate),
        '-ac', '1',
        '-i', inPath,
        '-c:a', 'libopus',
        '-b:a', '32k',
        '-application', 'voip',
        '-f', 'ogg',
        outPath,
      ]);
      let stderr = '';
      proc.stderr.on('data', (b) => { stderr += b.toString(); });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited ${code}: ${stderr.trim()}`));
      });
    });
    return readFileSync(outPath);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

export function isOggOpus(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 4 && buf.slice(0, 4).toString('ascii') === 'OggS';
}
