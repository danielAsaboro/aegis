/**
 * Vercel AI SDK provider factory for QVAC.
 *
 * Usage:
 *   import { qvac, createQvac } from 'ai-sdk-qvac';
 *   const result = await generateText({
 *     model: qvac('local'),
 *     prompt: 'Hello',
 *   });
 *
 * The model id is currently a placeholder — QVAC takes its model file
 * from env.QVAC_LLM_MODEL_PATH. We accept any id (e.g. 'local',
 * 'qwen-2.5-7b-instruct') and forward it as the V2 modelId for telemetry.
 */

import { QvacLanguageModel } from './language-model.mjs';

export function createQvac(options = {}) {
  const make = (modelId, settings) => new QvacLanguageModel(modelId, settings || {}, {
    provider: options.providerName || 'qvac',
  });

  const provider = (modelId, settings) => make(modelId, settings);
  provider.languageModel = make;
  provider.chat = make; // alias matching common AI SDK provider naming
  provider.textEmbeddingModel = (modelId) => {
    throw new Error(`Embedding models are exposed through engine/qvac/embeddings.mjs, not the AI SDK provider entry. Asked for "${modelId}".`);
  };
  return provider;
}

export const qvac = createQvac();
