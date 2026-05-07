/**
 * Typed errors and model-path assertions for ai-sdk-qvac.
 *
 * Vendored from AEGIS's `engine/qvac/index.mjs` so this package has no
 * cross-repo imports. Throwing typed errors lets callers degrade
 * gracefully (e.g. fall back to a different provider) instead of
 * silently substituting a cloud API.
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

export function assertModelFile(label, path) {
  if (!path) {
    throw new QvacUnavailableError(label, 'model path not configured');
  }
  if (!existsSync(path)) {
    throw new QvacUnavailableError(label, `model file not found at ${path}`);
  }
  const st = statSync(path);
  if (!st.isFile()) {
    throw new QvacUnavailableError(label, `${path} is not a regular file`);
  }
}
