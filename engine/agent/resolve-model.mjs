/**
 * Model resolver — subscription and local-only.
 *
 * AEGIS deliberately does NOT support API-key billed providers. The agent
 * is the user's autonomous trading operator; routing it through a metered
 * key would charge the wrong party for autonomy and re-introduce a cloud
 * dependency the QVAC integration is built to remove.
 *
 * Two paths only:
 *   - codex/*  → ChatGPT subscription via the local Codex CLI (resolved as
 *                an AI SDK-compatible language model in providers/codex.mjs).
 *   - qvac/*   → fully on-device LLM through the Bare-runtime QVAC sidecar
 *                (handled here — returns a LanguageModelV2 from the
 *                ai-sdk-qvac provider).
 *
 * `claude-code/*` is reserved for a future Claude Code MCP provider; it
 * will land alongside `providers/claude-code.mjs` and route through the
 * subscription dispatcher, not through this file.
 */

import { qvac } from '../qvac/ai-sdk-provider/index.mjs';
import env from '../config.mjs';
import { createProviderLanguageModel, isProviderModel } from './providers/index.mjs';

export const SUBSCRIPTION_MODELS = [
  'codex/default',
  'qvac/local',
  // 'claude-code/default',  // future: Claude subscription via Claude Code MCP
];

export function isValidModel(modelId) {
  if (typeof modelId !== 'string') return false;
  if (SUBSCRIPTION_MODELS.includes(modelId)) return true;
  if (isProviderModel(modelId)) return true;
  const idx = modelId.indexOf('/');
  if (idx === -1) return false;
  const provider = modelId.slice(0, idx);
  return provider === 'qvac';
}

export async function resolveModel(modelId) {
  if (isProviderModel(modelId)) {
    return await createProviderLanguageModel(modelId);
  }

  const idx = modelId.indexOf('/');
  if (idx === -1) {
    throw new Error(
      `Invalid model format: "${modelId}". Expected "<provider>/<model>" (e.g. qvac/local, codex/default).`
    );
  }
  const provider = modelId.slice(0, idx);
  const name = modelId.slice(idx + 1);

  if (provider === 'qvac') {
    if (!env.QVAC_LLM_MODEL_PATH) {
      throw new Error(
        `QVAC_LLM_MODEL_PATH is not set but AEGIS_AGENT_MODEL="${modelId}" requires it. ` +
        `Run \`pnpm qvac:download\` to fetch a local GGUF chat model, or point ` +
        `QVAC_LLM_MODEL_PATH at one you already have.`
      );
    }
    return qvac(name);
  }

  throw new Error(
    `Unsupported provider "${provider}" in model "${modelId}". ` +
    `AEGIS supports subscription providers (codex/*) and local providers (qvac/*) only — ` +
    `no API-key billed paths. Available: ${SUBSCRIPTION_MODELS.join(', ')}.`
  );
}
