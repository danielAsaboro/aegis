/**
 * Audio transcoding tests — exercise the real ffmpeg binary that ships
 * with `ffmpeg-static`. If ffmpeg-static isn't installed yet, the live
 * test is skipped (no mocks).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.TELEGRAM_BOT_TOKEN ??= 'test_token';
process.env.ZERION_API_KEY ??= 'test_key';

const audio = await import('../../../engine/qvac/audio.mjs');

describe('QVAC audio helpers', () => {
  test('isOggOpus detects OggS magic bytes', () => {
    assert.equal(audio.isOggOpus(Buffer.from('OggS\x00\x00')), true);
    assert.equal(audio.isOggOpus(Buffer.from('RIFF')), false);
    assert.equal(audio.isOggOpus(Buffer.alloc(0)), false);
  });

  test('transcodeToWav16k rejects empty input', async () => {
    await assert.rejects(() => audio.transcodeToWav16k(Buffer.alloc(0)));
  });

  test('pcmToOggOpus rejects bad sampleRate', async () => {
    await assert.rejects(() => audio.pcmToOggOpus(Int16Array.of(1, 2, 3), 0));
  });
});

describe('QVAC ffmpeg roundtrip', { skip: !audio.getFfmpegPath() }, () => {
  test('PCM → OGG/Opus output starts with OggS magic', async () => {
    // 1 second of 440 Hz tone at 24 kHz mono.
    const sr = 24_000;
    const samples = new Int16Array(sr);
    for (let i = 0; i < sr; i++) {
      samples[i] = Math.round(0.2 * 32767 * Math.sin(2 * Math.PI * 440 * i / sr));
    }
    const ogg = await audio.pcmToOggOpus(samples, sr);
    assert.ok(ogg.length > 100, 'expected non-empty OGG output');
    assert.ok(audio.isOggOpus(ogg), 'expected OggS magic at start of output');
  });
});
