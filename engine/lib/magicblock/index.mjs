/**
 * MagicBlock Private Payments integration
 * Re-exports for clean imports
 */

export {
  MagicBlockClient,
  createMagicBlockClient,
  createMagicBlockClientFromSecret,
  getTokenMint,
  getTokenDecimals,
  TOKEN_MINTS,
  TOKEN_DECIMALS,
} from './client.mjs';
