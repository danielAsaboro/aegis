/**
 * Language-model provider registry for subscription-backed backends.
 *
 * Every registered provider resolves to an AI SDK-compatible language model,
 * so the AEGIS agent loop can stay uniform across Codex, QVAC, and future
 * providers.
 */

const PROVIDERS = {
  codex: async () => {
    const m = await import('./codex.mjs');
    return m.codex;
  },
  // 'claude-code': async () => (await import('./claude-code.mjs')).claudeCode,
  // 'gemini':      async () => (await import('./gemini.mjs')).gemini,
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

export function parseProviderModel(modelId) {
  if (typeof modelId !== 'string') return null;
  const idx = modelId.indexOf('/');
  if (idx === -1) return null;
  const provider = modelId.slice(0, idx);
  const model = modelId.slice(idx + 1);
  if (!(provider in PROVIDERS)) return null;
  return { provider, model };
}

export function isProviderModel(modelId) {
  return parseProviderModel(modelId) !== null;
}

export async function createProviderLanguageModel(modelId) {
  const parsed = parseProviderModel(modelId);
  if (!parsed) {
    throw new Error(
      `No subscription provider registered for "${modelId}". ` +
      `Known providers: ${PROVIDER_IDS.join(', ')}.`
    );
  }
  const factory = PROVIDERS[parsed.provider];
  const provider = await factory();
  return provider(parsed.model);
}
