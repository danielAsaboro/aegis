/**
 * Vercel AI SDK provider factory for QVAC.
 *
 * Usage:
 *   import { generateText } from 'ai';
 *   import { qvac } from 'ai-sdk-qvac';
 *
 *   const result = await generateText({
 *     model: qvac('local'),
 *     prompt: 'Hello',
 *   });
 *
 * The model id is informational — QVAC takes its model file from
 * QVAC_LLM_MODEL_PATH (a GGUF chat model). We accept any id (e.g.
 * 'local', 'qwen-2.5-7b-instruct') and forward it as the V2 modelId for
 * telemetry.
 */

import { QvacLanguageModel } from './language-model.mjs';

export function createQvac(options = {}) {
  const make = (modelId, settings) => new QvacLanguageModel(modelId, settings || {}, {
    provider: options.providerName || 'qvac',
  });

  const provider = (modelId, settings) => make(modelId, settings);
  provider.languageModel = make;
  provider.chat = make;
  provider.textEmbeddingModel = (modelId) => {
    throw new Error(`Embedding models are not exposed through ai-sdk-qvac yet. Use @qvac/embed-llamacpp directly. Asked for "${modelId}".`);
  };
  return provider;
}

export const qvac = createQvac();
