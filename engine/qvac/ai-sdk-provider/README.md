# ai-sdk-qvac

[Vercel AI SDK](https://sdk.vercel.ai) community provider for [Tether
QVAC](https://docs.qvac.tether.io) — run local-first, on-device LLMs
through the same `generateText` / `streamText` / `ToolLoopAgent` API you
already use for OpenAI and Anthropic.

```ts
import { generateText } from 'ai';
import { qvac } from 'ai-sdk-qvac';

const { text } = await generateText({
  model: qvac('local'),
  prompt: 'Why is local-first AI better for an autonomous trading agent?',
});
```

The model file is loaded once on first call from `QVAC_LLM_MODEL_PATH`
(GGUF), via `@qvac/llm-llamacpp`. No keys, no cloud round-trips, no
data leaving the device.

## Tool calling

Implements the V2 specification's `tool-call` content/stream parts. The
SDK's tool loop dispatches tools exactly as it does for any other
provider; approval gates, telemetry, structured outputs all keep working.

Models that emit `<tool_call>{...}</tool_call>` blocks (Qwen-2.5 / 3,
Llama-3.1 Instruct, Hermes-3, Mistral-Nemo Instruct) work out of the box.

## Configuration

Environment variables consumed by the underlying QVAC adapter:

- `QVAC_LLM_MODEL_PATH` — path to the GGUF chat model
- `QVAC_LLM_DEVICE` — `cpu` | `gpu`
- `QVAC_LLM_GPU_LAYERS` — number of layers offloaded to GPU
- `QVAC_LLM_CTX_SIZE` — KV-cache context window
- `QVAC_LLM_TEMP` — sampling temperature
- `QVAC_LLM_PREDICT` — max tokens per turn

## Architecture

The QVAC native bindings only load under the [Bare
runtime](https://github.com/holepunchto/bare). To run from a Node.js
host, this package spawns a Bare sidecar subprocess that owns the model
and speaks line-delimited JSON-RPC over stdio. The sidecar lives at
`engine/qvac/sidecar/sidecar.cjs`; the Node-side client is
`engine/qvac/sidecar/client.mjs`. Both halves run the real packages on
the runtimes they were built for — no shims, no FFI tricks, no mocks.

## Limitations

- Text-only. File parts (images, audio, PDFs) are skipped with a
  warning. For STT use `@qvac/transcription-whispercpp` directly.
- Token-level usage stats depend on what the underlying llama.cpp build
  reports through `response.stats`.
- A single sidecar instance allows one concurrent inference at a time
  (llama.cpp limitation). Spawn separate sidecars or queue requests.
