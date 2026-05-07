/**
 * ai-sdk-qvac — Vercel AI SDK community provider for Tether QVAC.
 *
 * Public surface:
 *   - qvac(modelId)         → LanguageModelV2 (default factory)
 *   - createQvac(options)   → custom factory
 *   - QvacLanguageModel     → class for advanced usage
 *   - parseToolCalls        → helper for parsing tool-call blocks
 *   - QvacUnavailableError  → typed error when the model isn't loadable
 *   - shutdownSidecar       → graceful sidecar teardown for clean exits
 */

export { createQvac, qvac } from './provider.mjs';
export { QvacLanguageModel } from './language-model.mjs';
export { parseToolCalls, getLLM, createLLM } from './llm.mjs';
export { QvacUnavailableError, assertModelFile } from './errors.mjs';
export { shutdownSidecar, getSidecar, SidecarUnavailableError } from './sidecar/client.mjs';
