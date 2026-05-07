# ai-sdk-qvac

[![npm](https://img.shields.io/npm/v/ai-sdk-qvac.svg)](https://www.npmjs.com/package/ai-sdk-qvac)

[Vercel AI SDK](https://sdk.vercel.ai) community provider for [Tether
QVAC](https://docs.qvac.tether.io) — run local-first, on-device LLMs
through the same `generateText` / `streamText` / `ToolLoopAgent` APIs
you already use for OpenAI and Anthropic.

```ts
import { generateText } from 'ai';
import { qvac } from 'ai-sdk-qvac';

const { text } = await generateText({
  model: qvac('local'),
  prompt: 'Why is local-first AI better for an autonomous trading agent?',
});
```

The model file is loaded once on first call from `QVAC_LLM_MODEL_PATH`
(GGUF) via `@qvac/llm-llamacpp`. **No keys, no cloud round-trips, no
data leaves the device.**

## Install

```bash
pnpm add ai-sdk-qvac \
        @ai-sdk/provider ai \
        @qvac/llm-llamacpp \
        bare-runtime bare-process bare-fs bare-os bare-path \
        bare-runtime-darwin-arm64   # or your platform's binary
```

Platform binaries: `bare-runtime-darwin-arm64`,
`bare-runtime-darwin-x64`, `bare-runtime-linux-arm64`,
`bare-runtime-linux-x64`, `bare-runtime-win32-x64`.

## Tool calling

Implements the V2 specification's `tool-call` content/stream parts. The
SDK's tool loop dispatches tools exactly as it does for any other
provider; approval gates, telemetry, structured outputs all keep working.

Models that emit fenced ```tool_call JSON blocks (Qwen 2.5 / 3, Hermes-3,
Llama-3.1 Instruct, Mistral-Nemo Instruct) work out of the box. The
provider also recognises the `<tool_call>...</tool_call>` XML form and
the `[TOOL_CALLS]...[/TOOL_CALLS]` Mistral form.

```ts
import { generateText, tool } from 'ai';
import { qvac } from 'ai-sdk-qvac';
import { z } from 'zod';

const result = await generateText({
  model: qvac('local'),
  tools: {
    getPortfolio: tool({
      description: 'Return the user portfolio.',
      inputSchema: z.object({}),
      execute: async () => ({ totalUsd: 1847.32, sol: 8.21, usdc: 234.99 }),
    }),
  },
  prompt: 'What is in my portfolio?',
});
```

## Configuration (env vars)

All parameters are read from `process.env` on first call:

| Variable | Default | Description |
|---|---|---|
| `QVAC_LLM_MODEL_PATH` | _(required)_ | Path to a GGUF chat model on disk. |
| `QVAC_LLM_DEVICE` | `cpu` | `cpu` or `gpu`. |
| `QVAC_LLM_GPU_LAYERS` | `99` | Layers to offload to GPU when `device=gpu`. |
| `QVAC_LLM_CTX_SIZE` | `8192` | KV-cache context window. |
| `QVAC_LLM_TEMP` | `0.4` | Sampling temperature. |
| `QVAC_LLM_PREDICT` | `1024` | Max tokens per turn. |
| `DEBUG_AI_SDK_QVAC` | _(unset)_ | Set to `1` to log info+debug to stderr. |

## Architecture

The QVAC native bindings only load under the
[Bare runtime](https://github.com/holepunchto/bare). To run from a
Node.js host, this package spawns a Bare sidecar subprocess that owns
the model and speaks line-delimited JSON-RPC over stdio.

```
┌─────────────────────────┐         ┌──────────────────────────┐
│  Node.js host           │  stdio  │  Bare-runtime sidecar     │
│  (Vercel AI SDK)        │ ◄────►  │  (sidecar.cjs)            │
│  ai-sdk-qvac provider   │  JSON   │  @qvac/llm-llamacpp       │
└─────────────────────────┘         └──────────────────────────┘
```

Both halves run the real packages on the runtimes they were built for —
no shims, no FFI tricks, no mocks. Sidecar lifecycle is automatic; call
`shutdownSidecar()` from the package's main export for clean shutdown.

```ts
import { shutdownSidecar } from 'ai-sdk-qvac';
process.on('SIGINT', async () => { await shutdownSidecar(); process.exit(0); });
```

## Errors

`QvacUnavailableError` is thrown when the model file is missing or
unloadable. Catch it and degrade to a different provider — never
silently substitute a cloud API.

```ts
import { qvac, QvacUnavailableError } from 'ai-sdk-qvac';

try {
  const r = await generateText({ model: qvac('local'), prompt });
} catch (err) {
  if (err instanceof QvacUnavailableError) {
    // Fall back to a different provider, surface to user, etc.
  }
  throw err;
}
```

## Limitations

- Text-only. File parts (images, audio, PDFs) are skipped with a
  warning. For STT use `@qvac/transcription-whispercpp` directly.
- Token-level usage stats depend on what the underlying llama.cpp build
  reports through `response.stats`.
- A single sidecar instance allows one concurrent inference at a time
  (llama.cpp limitation). Spawn separate sidecars or queue requests.

## Origin

Extracted from [AEGIS](https://github.com/danielAsaboro/aegis), an
autonomous Solana trading agent that uses QVAC for fully on-device
reasoning, voice, and embeddings — built for the Frontier Hackathon
(Zerion + MagicBlock + Tether QVAC tracks).

## License

Apache-2.0
