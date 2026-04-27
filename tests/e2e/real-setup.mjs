#!/usr/bin/env node
/**
 * Real E2E Test Environment Setup
 * 
 * Sets up real test environment for AEGIS end-to-end testing:
 * - Real wallets with real devnet SOL
 * - Real Zerion API calls
 * - Real MagicBlock integration
 * - Real Telegram bot (test mode)
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { Keypair, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { initStateStore } from '../../engine/store/state.mjs';
import { initPlansStore } from '../../engine/store/plans.mjs';
import { initExecutionsStore } from '../../engine/store/executions.mjs';
import { initShieldStore } from '../../engine/store/shield.mjs';

// Real test environment configuration
export const REAL_E2E_CONFIG = {
  // Test timeout
  TIMEOUT: 120000, // 2 minutes for real API calls
  
  // Minimum balances needed for tests
  MIN_SOL_BALANCE: 0.1, // 0.1 SOL minimum
  MIN_USDC_BALANCE: 10,  // 10 USDC minimum
  
  // Real devnet endpoints
  SOLANA_RPC: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  MAGICBLOCK_RPC: process.env.MAGICBLOCK_RPC_URL || 'https://rpc.magicblock.app/devnet',
  MAGICBLOCK_EPHEMERAL: process.env.MAGICBLOCK_EPHEMERAL_URL || 'https://devnet.magicblock.app',
  
  // Test amounts (small amounts for real testing)
  TEST_DCA_AMOUNT: 1, // $1 DCA
  TEST_TRADE_AMOUNT: 0.5, // $0.50 trade
  TEST_SHIELD_AMOUNT: 0.001, // 0.001 SOL for shield test
};

/**
 * Create real test environment with actual services
 */
export async function createRealTestEnvironment() {
  const testDir = mkdtempSync(join(tmpdir(), 'aegis-real-e2e-'));
  
  // Initialize stores
  initStateStore(testDir);
  initPlansStore(testDir);
  initExecutionsStore(testDir);
  initShieldStore(testDir);
  
  console.log(`[REAL E2E] Test environment created: ${testDir}`);
  
  return {
    testDir,
    cleanup: () => {
      try {
        require('fs').rmSync(testDir, { recursive: true, force: true });
        console.log(`[REAL E2E] Test environment cleaned up`);
      } catch (err) {
        console.warn('[REAL E2E] Cleanup failed:', err.message);
      }
    }
  };
}

/**
 * Setup real test environment variables
 */
export function setupRealTestEnv(testDir) {
  const originalEnv = { ...process.env };
  
  // Validate required environment variables
  const required = [
    'TELEGRAM_BOT_TOKEN',
    'ZERION_API_KEY',
    'SOLANA_PRIVATE_KEY'
  ];
  
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  
  // Set test-specific overrides
  process.env.DATA_DIR = testDir;
  process.env.LOG_LEVEL = 'info';
  process.env.PRIVACY_MODE = 'auto';
  process.env.PRIVACY_THRESHOLD_USD = '100';
  process.env.PRIVACY_TOKENS = 'SOL,USDC';
  process.env.DEFAULT_CHAIN = 'solana';
  
  // Use real MagicBlock endpoints
  process.env.MAGICBLOCK_RPC_URL = REAL_E2E_CONFIG.MAGICBLOCK_RPC;
  process.env.MAGICBLOCK_EPHEMERAL_URL = REAL_E2E_CONFIG.MAGICBLOCK_EPHEMERAL;
  
  console.log('[REAL E2E] Environment variables configured');
  
  // Return restore function
  return () => {
    Object.keys(process.env).forEach(key => {
      if (key in originalEnv) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    });
  };
}

/**
 * Validate wallet has sufficient funds for testing
 */
export async function validateWalletFunds(keypair) {
  const connection = new Connection(REAL_E2E_CONFIG.SOLANA_RPC, 'confirmed');
  
  // Check SOL balance
  const solBalance = await connection.getBalance(keypair.publicKey);
  const solAmount = solBalance / LAMPORTS_PER_SOL;
  
  console.log(`[REAL E2E] Wallet SOL balance: ${solAmount.toFixed(4)} SOL`);
  
  if (solAmount < REAL_E2E_CONFIG.MIN_SOL_BALANCE) {
    const address = keypair.publicKey.toBase58();
    throw new Error(
      `Insufficient SOL balance for testing. Required: ${REAL_E2E_CONFIG.MIN_SOL_BALANCE} SOL, ` +
      `Current: ${solAmount.toFixed(4)} SOL. ` +
      `Fund wallet: solana airdrop 1 ${address} --url devnet`
    );
  }
  
  return {
    sol: solAmount,
    address: keypair.publicKey.toBase58()
  };
}

/**
 * Test real Zerion API connectivity
 */
export async function validateZerionAPI() {
  const apiKey = process.env.ZERION_API_KEY;
  
  try {
    const basicAuth = Buffer.from(`${apiKey}:`).toString('base64');
    const response = await fetch('https://api.zerion.io/v1/chains', {
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Zerion API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log(`[REAL E2E] Zerion API connected - ${data.data?.length || 0} chains available`);
    return true;
  } catch (err) {
    throw new Error(`Zerion API validation failed: ${err.message}`);
  }
}

/**
 * Test real MagicBlock connectivity
 */
export async function validateMagicBlockAPI() {
  try {
    // Test basic RPC connectivity
    const response = await fetch(REAL_E2E_CONFIG.MAGICBLOCK_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getVersion'
      })
    });
    
    if (!response.ok) {
      throw new Error(`MagicBlock RPC error: ${response.status}`);
    }
    
    const data = await response.json();
    console.log(`[REAL E2E] MagicBlock RPC connected - Version: ${data.result?.['solana-core'] || 'unknown'}`);
    
    // Test Ephemeral API
    const ephemeralResponse = await fetch(`${REAL_E2E_CONFIG.MAGICBLOCK_EPHEMERAL}/health`, {
      method: 'GET'
    });
    
    console.log(`[REAL E2E] MagicBlock Ephemeral API status: ${ephemeralResponse.status}`);
    return true;
  } catch (err) {
    throw new Error(`MagicBlock API validation failed: ${err.message}`);
  }
}

/**
 * Create real Telegram bot for testing
 */
export function createRealTestBot() {
  const { Telegraf } = require('telegraf');
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN required for E2E tests');
  }
  
  const bot = new Telegraf(botToken);
  
  // Store test messages for validation
  const testMessages = [];
  
  // Override reply methods to capture messages
  const originalReply = bot.telegram.sendMessage.bind(bot.telegram);
  bot.telegram.sendMessage = async (chatId, text, extra) => {
    testMessages.push({ chatId, text, extra, timestamp: Date.now() });
    console.log(`[REAL E2E BOT] Message to ${chatId}: ${text.slice(0, 100)}...`);
    // Don't actually send during tests unless explicitly enabled
    if (process.env.ACTUALLY_SEND_TELEGRAM_MESSAGES === 'true') {
      return originalReply(chatId, text, extra);
    }
    return { message_id: Date.now() };
  };
  
  return {
    bot,
    getTestMessages: () => testMessages,
    clearTestMessages: () => testMessages.length = 0
  };
}

/**
 * Wait for real condition with timeout
 */
export function waitForReal(conditionFn, timeoutMs = REAL_E2E_CONFIG.TIMEOUT, intervalMs = 1000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const check = async () => {
      try {
        const result = await conditionFn();
        if (result) {
          resolve(result);
          return;
        }
      } catch (err) {
        console.warn(`[REAL E2E] Condition check error: ${err.message}`);
      }
      
      if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Real condition not met within ${timeoutMs}ms`));
        return;
      }
      
      setTimeout(check, intervalMs);
    };
    
    check();
  });
}

/**
 * Pre-flight checks for real E2E testing
 */
export async function runPreflightChecks(keypair) {
  console.log('[REAL E2E] Running preflight checks...');
  
  try {
    // 1. Validate wallet funds
    await validateWalletFunds(keypair);
    
    // 2. Test Zerion API
    await validateZerionAPI();
    
    // 3. Test MagicBlock API
    await validateMagicBlockAPI();
    
    console.log('[REAL E2E] ✅ All preflight checks passed');
    return true;
  } catch (err) {
    console.error('[REAL E2E] ❌ Preflight check failed:', err.message);
    throw err;
  }
}

export default {
  REAL_E2E_CONFIG,
  createRealTestEnvironment,
  setupRealTestEnv,
  validateWalletFunds,
  validateZerionAPI,
  validateMagicBlockAPI,
  createRealTestBot,
  waitForReal,
  runPreflightChecks
};