/**
 * QVAC sidecar — runs under the Bare runtime and exposes
 * @qvac/embed-llamacpp, @qvac/transcription-whispercpp, @qvac/tts-onnx,
 * and @qvac/llm-llamacpp over a line-delimited JSON-RPC protocol on
 * stdin/stdout.
 *
 * Why a sidecar: QVAC native bindings only load under Bare (they call
 * `require.addon()` and depend on bare-fs / bare-process). AEGIS itself
 * runs under Node.js (Prisma, Telegraf, ai-sdk-v6 all assume Node).
 * This subprocess is the bridge.
 *
 * Protocol (line-delimited JSON):
 *   request:  {"id": "<string>", "op": "<embed|transcribe|tts|llm-chat|llm-cancel|unload>", ...}
 *   response: {"id": "<same>", "ok": true, "result": ...}
 *           | {"id": "<same>", "ok": false, "error": {"message": "...", "code": "..."}}
 *           | {"id": "<same>", "event": "...", "data": ...}     (streaming events)
 *
 * Streaming responses (LLM chat tokens, transcription segments) emit
 * `{event: "token", data: "..."}` frames before the terminating
 * `{ok: true, result: ...}` frame.
 */

const proc = require('bare-process')
const fs = require('bare-fs')
const path = require('bare-path')
const os = require('bare-os')

let GGMLBert = null
let TranscriptionWhispercpp = null
let ONNXTTS = null
let LlmLlamacpp = null

function lazyLoad (name) {
  switch (name) {
    case 'embed':
      if (!GGMLBert) GGMLBert = require('@qvac/embed-llamacpp')
      return GGMLBert
    case 'whisper':
      if (!TranscriptionWhispercpp) TranscriptionWhispercpp = require('@qvac/transcription-whispercpp')
      return TranscriptionWhispercpp
    case 'tts': {
      if (!ONNXTTS) {
        const mod = require('@qvac/tts-onnx')
        ONNXTTS = mod.ONNXTTS || mod
      }
      return ONNXTTS
    }
    case 'llm':
      if (!LlmLlamacpp) LlmLlamacpp = require('@qvac/llm-llamacpp')
      return LlmLlamacpp
  }
}

let embedder = null
let transcriber = null
let tts = null
let llm = null
let llmActive = null

function send (frame) {
  proc.stdout.write(JSON.stringify(frame) + '\n')
}

function err (id, e) {
  send({ id, ok: false, error: { message: e?.message || String(e), code: e?.code || null } })
}

function ok (id, result) {
  send({ id, ok: true, result })
}

function event (id, name, data) {
  send({ id, event: name, data })
}

async function loadEmbedder (req) {
  if (embedder) return
  const Mod = lazyLoad('embed')
  embedder = new Mod({
    files: { model: [req.modelPath] },
    config: {
      device: req.device || 'cpu',
      gpu_layers: String(req.gpuLayers ?? (req.device === 'gpu' ? 99 : 0)),
      batch_size: '1024',
      ctx_size: '512',
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    opts: { stats: true },
  })
  await embedder.load()
}

function unwrapEmbedding (raw) {
  // Real shape from @qvac/embed-llamacpp@0.14: [[Float32Array(dim)]]
  let v = raw
  while (Array.isArray(v) && v.length === 1 && (Array.isArray(v[0]) || ArrayBuffer.isView(v[0]))) {
    v = v[0]
  }
  if (!v || typeof v.length !== 'number') {
    throw new Error('embed: unexpected shape ' + JSON.stringify(raw).slice(0, 200))
  }
  return Array.from(v)
}

async function handleEmbed (req) {
  await loadEmbedder(req)
  const response = await embedder.run(req.text)
  const raw = await response.await()
  const vec = unwrapEmbedding(raw)
  ok(req.id, { vector: vec, dim: vec.length, model: req.model || path.basename(req.modelPath) })
}

async function loadTranscriber (req) {
  if (transcriber) return
  const Mod = lazyLoad('whisper')
  const args = {
    files: {
      model: req.modelPath,
      ...(req.vadModelPath ? { vadModel: req.vadModelPath } : {}),
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  }
  const config = {
    whisperConfig: {
      language: req.language || 'en',
      temperature: 0.0,
      suppress_nst: true,
      n_threads: 0,
    },
    contextParams: {
      use_gpu: !!req.useGpu,
      gpu_device: 0,
    },
    miscConfig: { caption_enabled: true },
  }
  transcriber = new Mod(args, config)
  await transcriber.load()
  transcriber._config = config
}

async function _resetTranscriberLanguage (lang) {
  if (transcriber?._config?.whisperConfig) {
    transcriber._config.whisperConfig.language = lang
  }
}

async function handleTranscribe (req) {
  await loadTranscriber(req)
  if (req.language) await _resetTranscriberLanguage(req.language)

  // req.audioBase64 is a 16kHz mono WAV that the caller already transcoded.
  // Write to a tmp file and feed via createReadStream — the QVAC whisper
  // wrapper expects the same shape its README documents.
  const wav = Buffer.from(req.audioBase64, 'base64')
  const tmpPath = path.join(os.tmpdir(), `qvac-stt-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`)
  fs.writeFileSync(tmpPath, wav)

  let response
  try {
    const stream = fs.createReadStream(tmpPath)
    response = await transcriber.run(stream)

    let fullText = ''
    const segments = []

    // The QVAC whisper iterate() yields ARRAYS of segment objects, where
    // each segment looks like {text, start, end, id, toAppend}. The text
    // field embeds timestamp markers like "<|0|>...<|3|>" — strip them
    // before concatenating.
    const collect = (segArr) => {
      const arr = Array.isArray(segArr) ? segArr : [segArr]
      for (const seg of arr) {
        if (!seg) continue
        const raw = typeof seg === 'string'
          ? seg
          : (seg.text ?? seg.segment?.text ?? seg.transcript ?? '')
        if (!raw) continue
        const cleaned = String(raw).replace(/<\|[^|]*\|>/g, '').trim()
        if (!cleaned) continue
        fullText += (fullText && !fullText.endsWith(' ') ? ' ' : '') + cleaned
        segments.push({
          text: cleaned,
          start: seg.start ?? seg.t0 ?? null,
          end: seg.end ?? seg.t1 ?? null,
          speaker: seg.speaker ?? null,
        })
        event(req.id, 'segment', {
          text: cleaned,
          start: seg.start ?? seg.t0 ?? null,
          end: seg.end ?? seg.t1 ?? null,
        })
      }
    }

    for await (const chunk of response.iterate()) {
      collect(chunk)
    }
    ok(req.id, { text: fullText.trim(), segments, language: transcriber._config.whisperConfig.language })
  } finally {
    try { fs.unlinkSync(tmpPath) } catch (_) {}
  }
}

async function loadTTS (req) {
  if (tts) return
  const Mod = lazyLoad('tts')
  const args = {
    modelDir: req.modelDir,
    voiceName: req.voiceName || 'F1',
    speed: req.speed || 1,
    numInferenceSteps: req.numInferenceSteps || 5,
    opts: { stats: true },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  }
  const config = { language: req.language || 'en' }
  tts = new Mod(args, config)
  await tts.load()
}

async function handleTTS (req) {
  await loadTTS(req)
  const response = await tts.run({ input: req.text, type: 'text' })
  let sampleRate = 24000
  const samples = []
  await response.onUpdate((data) => {
    if (data?.outputArray) {
      for (let i = 0; i < data.outputArray.length; i++) samples.push(data.outputArray[i])
    }
    if (Number.isFinite(data?.sampleRate)) sampleRate = data.sampleRate
    if (Number.isFinite(data?.sample_rate)) sampleRate = data.sample_rate
  }).await()
  if (samples.length === 0) throw new Error('TTS produced no samples')

  // Convert to Int16 PCM and base64-encode for transport.
  const i16 = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]
    if (v >= -1 && v <= 1) i16[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)))
    else i16[i] = Math.max(-32768, Math.min(32767, v | 0))
  }
  const buf = Buffer.from(i16.buffer, i16.byteOffset, i16.byteLength)
  ok(req.id, { sampleRate, pcmBase64: buf.toString('base64'), durationSec: samples.length / sampleRate })
}

async function loadLLM (req) {
  if (llm) return
  const Mod = lazyLoad('llm')
  // Notes on this config:
  //
  // 1. We deliberately do NOT set `tools: 'true'`. That flag activates
  //    llama.cpp's jinja tool-call template which expects tool definitions
  //    to be passed through the native API. Our tools come from the Vercel
  //    AI SDK via the language-model.mjs prompt rendering, so the model
  //    needs to treat the conversation as plain chat and follow our textual
  //    fenced ```tool_call``` instructions. With `tools: 'true'` the
  //    template emits a bare `<tool_call>` structural marker and EOSes,
  //    which breaks the round-trip.
  //
  // 2. We deliberately do NOT set `predict` here. QVAC's LlmLlamacpp loads
  //    the model with the config supplied at FIRST run, and that config
  //    persists for the life of the process — passing `predict: 1` once
  //    (e.g. for a warm-up) would cap every subsequent generation at 1
  //    token. Instead we pass `predict` per-request via `generationParams`
  //    (see handleLLMChat below) which the QVAC sampler honors per-call.
  //    Same reasoning for temp / top_p — keep them as run-options, not
  //    load-options.
  llm = new Mod({
    files: { model: [req.modelPath] },
    config: {
      device: req.device || 'cpu',
      gpu_layers: String(req.gpuLayers ?? (req.device === 'gpu' ? 99 : 0)),
      ctx_size: String(req.ctxSize || 8192),
    },
    opts: { stats: true },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  })
  await llm.load()
}

async function handleLLMChat (req) {
  await loadLLM(req)
  if (llmActive) throw new Error('llm already running — cancel first')

  // Per-request sampler overrides. QVAC's LlmLlamacpp accepts these via
  // runOptions.generationParams; they DO NOT modify load-time state, so
  // every call gets exactly the predict / temp it asked for, regardless
  // of any prior call. This is the structural fix for the predict-locking
  // bug that bit us during initial bring-up (see qvac-hurdles.md).
  const generationParams = {}
  if (req.predict != null) generationParams.predict = Number(req.predict)
  if (req.temp != null) generationParams.temp = Number(req.temp)

  const response = await llm.run(req.messages, { generationParams })
  llmActive = response

  let buffer = ''
  let stoppedEarly = false
  try {
    for await (const token of response.iterate()) {
      const piece = typeof token === 'string'
        ? token
        : (token?.token ?? token?.text ?? token?.delta ?? '')
      if (!piece) continue
      buffer += piece
      event(req.id, 'token', piece)
      if (req.stopOnToolCall) {
        const xmlOpen = /<tool_call>/.test(buffer)
        const xmlClose = /<\/tool_call>/.test(buffer)
        // Match a complete fenced block: opener (```tool_call|tool|json or
        // bare ``` followed by `{`) PLUS a trailing ``` after at least one
        // closing brace on the JSON.
        const fenceClose = /```(?:tool_call|tool|json)?[^\n]*\n[\s\S]*?\}\s*\n?```/i.test(buffer)
        if ((xmlOpen && (xmlClose || buffer.length > 8192)) || fenceClose) {
          stoppedEarly = true
          try { await response.cancel() } catch (_) {}
          break
        }
      }
    }
  } finally {
    llmActive = null
  }
  ok(req.id, { raw: buffer, stoppedEarly, stats: response.stats || null })
}

async function handleLLMCancel (req) {
  if (llmActive) {
    try { await llmActive.cancel() } catch (_) {}
  }
  if (llm && typeof llm.cancel === 'function') {
    try { await llm.cancel() } catch (_) {}
  }
  ok(req.id, { ok: true })
}

async function handleUnload (req) {
  const target = req.target || 'all'
  const tasks = []
  if ((target === 'all' || target === 'embed') && embedder) tasks.push(embedder.unload().catch(() => {}).then(() => { embedder = null }))
  if ((target === 'all' || target === 'whisper') && transcriber) tasks.push(transcriber.unload().catch(() => {}).then(() => { transcriber = null }))
  if ((target === 'all' || target === 'tts') && tts) tasks.push(tts.unload().catch(() => {}).then(() => { tts = null }))
  if ((target === 'all' || target === 'llm') && llm) tasks.push(llm.unload().catch(() => {}).then(() => { llm = null }))
  await Promise.all(tasks)
  ok(req.id, { unloaded: target })
}

async function dispatch (req) {
  try {
    switch (req.op) {
      case 'embed': await handleEmbed(req); break
      case 'transcribe': await handleTranscribe(req); break
      case 'tts': await handleTTS(req); break
      case 'llm-chat': await handleLLMChat(req); break
      case 'llm-cancel': await handleLLMCancel(req); break
      case 'unload': await handleUnload(req); break
      case 'ping': ok(req.id, { pong: true, runtime: 'bare', pid: proc.pid }); break
      default: err(req.id, new Error(`unknown op: ${req.op}`))
    }
  } catch (e) {
    err(req.id, e)
  }
}

// stdin loop — line-delimited JSON.
let stdinBuf = ''
proc.stdin.on('data', (chunk) => {
  stdinBuf += chunk.toString('utf8')
  let idx
  while ((idx = stdinBuf.indexOf('\n')) >= 0) {
    const line = stdinBuf.slice(0, idx).trim()
    stdinBuf = stdinBuf.slice(idx + 1)
    if (!line) continue
    let req
    try { req = JSON.parse(line) }
    catch (e) {
      send({ id: null, ok: false, error: { message: 'invalid JSON: ' + e.message } })
      continue
    }
    dispatch(req)
  }
})

proc.stdin.on('end', () => {
  Bare.exit(0)
})

// Announce ready.
send({ event: 'ready', data: { pid: proc.pid } })
