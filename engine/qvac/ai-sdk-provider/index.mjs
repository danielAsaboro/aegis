/**
 * ai-sdk-qvac — Vercel AI SDK community provider for Tether's QVAC SDK.
 *
 * Designed to be extracted into its own npm package later. The directory
 * already carries a self-contained package.json so a `cp -r` extraction
 * Just Works.
 *
 * Public surface:
 *   - qvac(modelId)        → LanguageModelV2 (default factory)
 *   - createQvac(options)  → custom factory
 *   - QvacLanguageModel    → class for advanced usage
 */

export { createQvac, qvac } from './provider.mjs';
export { QvacLanguageModel } from './language-model.mjs';
