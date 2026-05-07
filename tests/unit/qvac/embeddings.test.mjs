/**
 * QVAC embedding wrapper tests.
 *
 * The model file is large (~140MB) so we don't ship it. If
 * QVAC_EMBED_MODEL_PATH is not set or the file is missing, the model-bound
 * test is skipped and we fall back to exercising the pure-function helpers
 * (cosine, vectorToBytes, bytesToVector) end-to-end. Both layers must work
 * for the integration to be real.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

process.env.TELEGRAM_BOT_TOKEN ??= 'test_token';
process.env.ZERION_API_KEY ??= 'test_key';

const { cosine, vectorToBytes, bytesToVector } = await import('../../../engine/qvac/embeddings.mjs');

describe('QVAC embeddings — pure helpers', () => {
  test('cosine of identical vectors is 1', () => {
    const v = Float32Array.from([0.1, 0.5, -0.3, 0.7]);
    assert.equal(Number(cosine(v, v).toFixed(6)), 1);
  });

  test('cosine of orthogonal vectors is 0', () => {
    const a = Float32Array.from([1, 0, 0]);
    const b = Float32Array.from([0, 1, 0]);
    assert.equal(cosine(a, b), 0);
  });

  test('cosine of opposite vectors is -1', () => {
    const a = Float32Array.from([0.5, -0.5]);
    const b = Float32Array.from([-0.5, 0.5]);
    assert.equal(Number(cosine(a, b).toFixed(6)), -1);
  });

  test('vectorToBytes ↔ bytesToVector roundtrip preserves values', () => {
    const v = Float32Array.from([0.0001, 1.5, -3.14, 9.81, 0]);
    const buf = vectorToBytes(v);
    assert.equal(buf.length, v.length * 4);
    const back = bytesToVector(buf);
    assert.equal(back.length, v.length);
    for (let i = 0; i < v.length; i++) {
      assert.ok(Math.abs(v[i] - back[i]) < 1e-6, `index ${i}`);
    }
  });

  test('cosine throws on length mismatch', () => {
    assert.throws(() => cosine(new Float32Array(3), new Float32Array(4)));
  });
});

describe('QVAC embeddings — live model', { skip: !process.env.QVAC_EMBED_MODEL_PATH || !existsSync(process.env.QVAC_EMBED_MODEL_PATH) }, () => {
  after(async () => {
    // Sidecar lives at process scope — close it so node:test can exit.
    const { shutdownSidecar } = await import('../../../engine/qvac/sidecar/client.mjs');
    await shutdownSidecar();
  });

  test('semantic similarity ranks paraphrase higher than unrelated text', async () => {
    const { createEmbedder } = await import('../../../engine/qvac/embeddings.mjs');
    const e = await createEmbedder();
    try {
      const a = await e.embed('buy 0.5 SOL with USDC on solana');
      const b = await e.embed('purchase half a SOL using USDC');
      const c = await e.embed('the cat sat on the mat');
      const simAB = e.cosine(a, b);
      const simAC = e.cosine(a, c);
      assert.ok(simAB > 0.5, `paraphrase similarity ${simAB} should be > 0.5`);
      assert.ok(simAB > simAC, `paraphrase ${simAB} should beat unrelated ${simAC}`);
    } finally {
      await e.unload();
    }
  });
});
