/**
 * QVAC adapter façade — local-first AI capabilities for AEGIS.
 *
 * All three resources (embedder, transcriber, tts) are lazy singletons.
 * Loading a model is expensive (hundreds of MB → VRAM/RAM) so we never
 * touch a package until the first call needs it.
 *
 * If a required model path is missing or the package fails to load, we
 * throw a typed `QvacUnavailableError` so callers can degrade gracefully
 * (e.g. the agent falls back from `searchFacts` to `recallFacts`). We do
 * NOT silently substitute a cloud API — that defeats the entire purpose
 * of the QVAC integration.
 */

import { existsSync, statSync } from 'node:fs';

export class QvacUnavailableError extends Error {
  constructor(capability, reason) {
    super(`QVAC capability "${capability}" unavailable: ${reason}`);
    this.code = 'qvac_unavailable';
    this.capability = capability;
    this.reason = reason;
  }
}

let _embedder = null;
let _embedderPromise = null;
let _transcriber = null;
let _transcriberPromise = null;
let _tts = null;
let _ttsPromise = null;
let _llm = null;
let _llmPromise = null;

export function assertModelFile(label, path) {
  if (!path) {
    throw new QvacUnavailableError(label, `model path not configured`);
  }
  if (!existsSync(path)) {
    throw new QvacUnavailableError(label, `model file not found at ${path}`);
  }
  const st = statSync(path);
  if (!st.isFile()) {
    throw new QvacUnavailableError(label, `${path} is not a regular file`);
  }
}

export function assertModelDir(label, dir) {
  if (!dir) {
    throw new QvacUnavailableError(label, `model directory not configured`);
  }
  if (!existsSync(dir)) {
    throw new QvacUnavailableError(label, `model directory not found at ${dir}`);
  }
  const st = statSync(dir);
  if (!st.isDirectory()) {
    throw new QvacUnavailableError(label, `${dir} is not a directory`);
  }
}

export async function getEmbedder() {
  if (_embedder) return _embedder;
  if (!_embedderPromise) {
    const { createEmbedder } = await import('./embeddings.mjs');
    _embedderPromise = createEmbedder().then((e) => { _embedder = e; return e; }, (err) => {
      _embedderPromise = null;
      throw err;
    });
  }
  return _embedderPromise;
}

export async function getTranscriber() {
  if (_transcriber) return _transcriber;
  if (!_transcriberPromise) {
    const { createTranscriber } = await import('./transcription.mjs');
    _transcriberPromise = createTranscriber().then((t) => { _transcriber = t; return t; }, (err) => {
      _transcriberPromise = null;
      throw err;
    });
  }
  return _transcriberPromise;
}

export async function getTTS() {
  if (_tts) return _tts;
  if (!_ttsPromise) {
    const { createTTS } = await import('./tts.mjs');
    _ttsPromise = createTTS().then((t) => { _tts = t; return t; }, (err) => {
      _ttsPromise = null;
      throw err;
    });
  }
  return _ttsPromise;
}

export async function getLLM() {
  if (_llm) return _llm;
  if (!_llmPromise) {
    const { createLLM } = await import('./llm.mjs');
    _llmPromise = createLLM().then((m) => { _llm = m; return m; }, (err) => {
      _llmPromise = null;
      throw err;
    });
  }
  return _llmPromise;
}

export async function unloadAll() {
  const tasks = [];
  if (_embedder?.unload) tasks.push(_embedder.unload().catch(() => {}));
  if (_transcriber?.unload) tasks.push(_transcriber.unload().catch(() => {}));
  if (_tts?.unload) tasks.push(_tts.unload().catch(() => {}));
  if (_llm?.unload) tasks.push(_llm.unload().catch(() => {}));
  await Promise.all(tasks);
  _embedder = null;
  _embedderPromise = null;
  _transcriber = null;
  _transcriberPromise = null;
  _tts = null;
  _ttsPromise = null;
  _llm = null;
  _llmPromise = null;
}
