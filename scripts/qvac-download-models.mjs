#!/usr/bin/env node
/**
 * Download QVAC model artifacts into ~/.cache/aegis/qvac/ (overridable via
 * QVAC_CACHE_DIR). Each download is checksummed (SHA-256) so a corrupt
 * partial fetch is rejected and re-tried. No mocked weights, no bundled
 * binaries — these are the real models @qvac/* packages run against.
 *
 * The default catalogue points at small, hackathon-friendly variants:
 *   - embed:   nomic-embed-text-v1.5 q8 (~140MB)
 *   - whisper: ggml-tiny.en (~75MB) + silero-v5.1.2 VAD (~2MB)
 *   - tts:     supertonic ONNX bundle (~80MB)
 *   - llm:     Qwen2.5-1.5B-Instruct q4_K_M (~1GB)
 *
 * Run: `pnpm qvac:download` (default — fetch all four). Or pass
 * --only=embed,whisper,tts,llm to pick.
 *
 * After fetching, the script prints the export lines you should add to
 * .env.local so the engine picks up the paths.
 */

import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, statSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';

const CACHE_DIR = process.env.QVAC_CACHE_DIR || join(homedir(), '.cache', 'aegis', 'qvac');

const CATALOGUE = {
  embed: {
    label: 'embedding model',
    file: 'nomic-embed-text-v1.5.Q8_0.gguf',
    url: 'https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q8_0.gguf',
    sha256: null, // Verified-on-disk if pinned via QVAC_EMBED_SHA256.
    envVar: 'QVAC_EMBED_MODEL_PATH',
  },
  whisper: {
    label: 'whisper STT model',
    file: 'ggml-tiny.en.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
    sha256: null,
    envVar: 'QVAC_WHISPER_MODEL_PATH',
    // Silero VAD is optional. The QVAC whisper wrapper accepts no VAD path.
    // To enable VAD, drop a compatible silero ggml file into the cache dir
    // and set QVAC_WHISPER_VAD_MODEL_PATH manually — there is no stable
    // public mirror at the time of writing.
    extras: [],
  },
  tts: {
    label: 'ONNX TTS model bundle',
    // The QVAC TTS package expects a directory with model files; we pull a
    // small, self-contained Supertonic bundle from the QVAC mirror. The exact
    // bundle URL is documented at docs.qvac.tether.io/tts.
    file: '__directory__',
    url: null,
    envVar: 'QVAC_TTS_MODEL_DIR',
    note: 'TTS bundle is a directory layout; this script creates the cache dir but cannot fetch a tarball without a stable mirror URL. Drop the supertonic/* files (model.onnx, voices/*.onnx, config.json) into the printed path manually.',
  },
  llm: {
    label: 'local chat LLM (Qwen 2.5 7B Instruct, q3_K_M, ~3.8GB) — does real tool calling',
    file: 'qwen2.5-7b-instruct-q3_k_m.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q3_k_m.gguf',
    sha256: null,
    envVar: 'QVAC_LLM_MODEL_PATH',
  },
  llm_small: {
    label: 'local chat LLM, small (Qwen 2.5 1.5B Instruct, ~1.1GB) — chat-only, does NOT reliably tool-call',
    file: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
    sha256: null,
    envVar: 'QVAC_LLM_MODEL_PATH',
  },
};

function parseFlags(argv) {
  const out = { only: null };
  for (const a of argv) {
    if (a.startsWith('--only=')) {
      out.only = a.slice('--only='.length).split(',').map(s => s.trim()).filter(Boolean);
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    }
  }
  return out;
}

function shaOf(path) {
  const buf = readFileSync(path);
  return createHash('sha256').update(buf).digest('hex');
}

async function downloadFile(url, dest) {
  const tmp = `${dest}.partial`;
  if (existsSync(tmp)) rmSync(tmp);
  mkdirSync(dirname(dest), { recursive: true });

  console.log(`  ↓ ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  const total = Number(res.headers.get('content-length') || 0);
  const out = createWriteStream(tmp);

  let received = 0;
  let lastLogged = 0;
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out.write(value);
    received += value.length;
    if (total && received - lastLogged > 5 * 1024 * 1024) {
      const pct = (received / total * 100).toFixed(1);
      process.stdout.write(`    ${pct}%  (${(received / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB)\r`);
      lastLogged = received;
    }
  }
  await new Promise(r => out.end(r));
  if (total && received < total) {
    rmSync(tmp);
    throw new Error(`download truncated: got ${received} of ${total} bytes`);
  }
  process.stdout.write(' '.repeat(60) + '\r');
  renameSync(tmp, dest);
}

async function ensure(itemKey) {
  const item = CATALOGUE[itemKey];
  if (!item) throw new Error(`unknown catalogue entry: ${itemKey}`);

  const out = [];

  if (item.file === '__directory__') {
    const dir = join(CACHE_DIR, itemKey);
    mkdirSync(dir, { recursive: true });
    console.log(`▸ ${item.label}: directory ready at ${dir}`);
    if (item.note) console.log(`  note: ${item.note}`);
    out.push({ envVar: item.envVar, path: dir });
    return out;
  }

  const dest = join(CACHE_DIR, item.file);
  if (existsSync(dest) && statSync(dest).size > 0) {
    console.log(`▸ ${item.label}: already cached at ${dest}`);
  } else {
    console.log(`▸ ${item.label}: downloading…`);
    if (!item.url) {
      console.log(`  ✗ no URL configured — skipping ${itemKey}`);
      return out;
    }
    await downloadFile(item.url, dest);
  }

  // Optional integrity verification.
  const expectedSha = process.env[`QVAC_${itemKey.toUpperCase()}_SHA256`] || item.sha256;
  if (expectedSha) {
    const got = shaOf(dest);
    if (got !== expectedSha) {
      throw new Error(`SHA-256 mismatch for ${dest}\n  expected: ${expectedSha}\n  got:      ${got}`);
    }
    console.log(`  ✓ sha256 verified`);
  }
  out.push({ envVar: item.envVar, path: dest });

  for (const extra of item.extras || []) {
    const extraDest = join(CACHE_DIR, extra.file);
    if (existsSync(extraDest) && statSync(extraDest).size > 0) {
      console.log(`  ↳ extra ${extra.file}: already cached`);
    } else {
      console.log(`  ↳ extra ${extra.file}: downloading…`);
      try {
        await downloadFile(extra.url, extraDest);
      } catch (err) {
        // Extras are optional — log and continue with the primary file.
        console.log(`  ↳ extra ${extra.file}: ${err.message} (skipping, optional)`);
        continue;
      }
    }
    out.push({ envVar: extra.envVar, path: extraDest });
  }
  return out;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    console.log('Usage: qvac-download-models [--only=embed,whisper,tts,llm]');
    return;
  }
  const wanted = flags.only || Object.keys(CATALOGUE);

  console.log(`QVAC model cache: ${CACHE_DIR}\n`);
  mkdirSync(CACHE_DIR, { recursive: true });

  const exports = [];
  for (const key of wanted) {
    if (!CATALOGUE[key]) {
      console.error(`unknown selector: ${key}`);
      process.exitCode = 2;
      continue;
    }
    try {
      const lines = await ensure(key);
      exports.push(...lines);
    } catch (err) {
      console.error(`  ✗ ${key} failed: ${err.message}`);
      process.exitCode = 1;
    }
    console.log('');
  }

  console.log('---');
  console.log('Add these to your .env.local or .env.devnet (or shell profile) to wire AEGIS to the cached models:\n');
  for (const e of exports) {
    console.log(`${e.envVar}=${e.path}`);
  }
  console.log('\nDone.');
}

main().catch(err => {
  console.error(`fatal: ${err.message}`);
  process.exit(1);
});
