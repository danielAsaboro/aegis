/**
 * Embeddings adapter — fronts the Bare-runtime QVAC sidecar.
 *
 * Public API:
 *   const e = await createEmbedder();
 *   const vec = await e.embed("buy 0.5 SOL with USDC");
 *   const sim = e.cosine(a, b);
 *   await e.unload();
 *
 * The sidecar holds the actual model in RAM; this module is just the
 * Node-side handle. Pure helpers (cosine, vectorToBytes, bytesToVector)
 * stay here so the indexer / search tools don't need to round-trip for
 * arithmetic.
 */

import { basename } from 'node:path';
import env from '../config.mjs';
import { createLogger } from '../core/logger.mjs';
import { QvacUnavailableError, assertModelFile } from './index.mjs';
import { getSidecar } from './sidecar/client.mjs';

const log = createLogger('qvac-embed');

export async function createEmbedder() {
  const modelPath = env.QVAC_EMBED_MODEL_PATH;
  assertModelFile('embeddings', modelPath);

  const sidecar = getSidecar();
  // First call lazily loads the model in the sidecar; do an eager warm-up
  // so subsequent embeds are predictable in latency.
  try {
    await sidecar.request('embed', {
      modelPath,
      device: env.QVAC_EMBED_DEVICE,
      gpuLayers: env.QVAC_EMBED_DEVICE === 'gpu' ? 99 : 0,
      text: 'init',
    });
  } catch (err) {
    if (err.code === 'qvac_sidecar_unavailable') {
      throw new QvacUnavailableError('embeddings', err.reason || err.message);
    }
    throw new QvacUnavailableError('embeddings', err.message || String(err));
  }

  const tag = basename(modelPath).replace(/\.(gguf|bin)$/i, '');
  log.info({ model: tag, device: env.QVAC_EMBED_DEVICE }, 'QVAC embedder warm');
  let dim = null;

  async function embed(text) {
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error('embed(): text must be a non-empty string');
    }
    const result = await sidecar.request('embed', {
      modelPath,
      device: env.QVAC_EMBED_DEVICE,
      gpuLayers: env.QVAC_EMBED_DEVICE === 'gpu' ? 99 : 0,
      text,
      model: tag,
    });
    const out = result?.vector instanceof Float32Array
      ? result.vector
      : Float32Array.from(result?.vector || []);
    if (out.length === 0) {
      throw new Error(`embed(): sidecar returned empty vector: ${JSON.stringify(result).slice(0, 200)}`);
    }
    if (dim == null) dim = out.length;
    return out;
  }

  function cosineImpl(a, b) {
    return cosine(a, b);
  }

  async function unload() {
    try { await sidecar.request('unload', { target: 'embed' }); }
    catch (err) { log.warn({ err: err.message }, 'embed unload failed'); }
  }

  return {
    embed,
    cosine: cosineImpl,
    unload,
    get model() { return tag; },
    get dim() { return dim; },
  };
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) {
    throw new Error(`cosine(): vector length mismatch (${a?.length} vs ${b?.length})`);
  }
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function vectorToBytes(vec) {
  const buf = Buffer.alloc(vec.length * 4);
  for (let i = 0; i < vec.length; i++) {
    buf.writeFloatLE(vec[i], i * 4);
  }
  return buf;
}

export function bytesToVector(buf) {
  if (!buf || buf.length % 4 !== 0) {
    throw new Error(`bytesToVector(): buffer length ${buf?.length} not divisible by 4`);
  }
  // Prisma's `Bytes` column type returns a Uint8Array, not a Node Buffer,
  // so don't rely on Buffer-specific methods. Use a DataView for portable
  // little-endian f32 reads.
  const u8 = buf instanceof Uint8Array ? buf : Uint8Array.from(buf);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const len = u8.byteLength / 4;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = view.getFloat32(i * 4, /* littleEndian */ true);
  }
  return out;
}
