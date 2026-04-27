#!/usr/bin/env node
/**
 * E2E Test Environment Setup
 * 
 * Sets up isolated test environment for AEGIS end-to-end testing:
 * - Test wallets and keypairs
 * - Mocked external APIs (Zerion, MagicBlock)
 * - Test data directories
 * - Environment configuration
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';
import { initStateStore } from '../../engine/store/state.mjs';
import { initPlansStore } from '../../engine/store/plans.mjs';
import { initExecutionsStore } from '../../engine/store/executions.mjs';
import { initShieldStore } from '../../engine/store/shield.mjs';

// Test environment configuration
export const E2E_CONFIG = {
  // Test wallet fixtures
  TEST_KEYPAIR: Keypair.generate(),
  TEST_WALLET_NAME: 'e2e-test-wallet',
  TEST_CHAT_ID: 12345,
  TEST_USER_ID: 67890,
  
  // Test API keys (fake but valid format)
  TEST_TELEGRAM_BOT_TOKEN: '7777777777:AAFakeTokenForE2ETestingPurposes',
  TEST_ZERION_API_KEY: 'zk_dev_fake_key_for_testing_12345',
  TEST_AGENT_TOKEN: 'agent_test_token_12345',

  // MagicBlock test endpoints
  TEST_MAGICBLOCK_RPC: 'http://localhost:8899',
  TEST_MAGICBLOCK_EPHEMERAL: 'http://localhost:3000',
  
  // Test amounts and thresholds
  TEST_SOL_BALANCE: 10_000_000_000, // 10 SOL in lamports
  TEST_USDC_BALANCE: 1000_000_000,  // 1000 USDC (6 decimals)
  PRIVACY_THRESHOLD: 100,
  
  // Test timing
  POLL_INTERVAL: 1000, // 1 second for fast tests
  TIMEOUT: 30000,      // 30 second test timeout
};

/**
 * Create isolated test environment
 */
export function createTestEnvironment() {
  const testDir = mkdtempSync(join(tmpdir(), 'aegis-e2e-'));
  
  // Initialize all stores in test directory
  initStateStore(testDir);
  initPlansStore(testDir);
  initExecutionsStore(testDir);
  initShieldStore(testDir);
  
  // Create test wallet keystore file
  const keystoreDir = join(testDir, 'wallets');
  const walletFile = join(keystoreDir, `${E2E_CONFIG.TEST_WALLET_NAME}.json`);
  
  // Create minimal keystore structure (matching Zerion CLI format)
  const walletData = {
    name: E2E_CONFIG.TEST_WALLET_NAME,
    created: new Date().toISOString(),
    accounts: {
      evm: null, // Not used for Solana tests
      solana: {
        publicKey: E2E_CONFIG.TEST_KEYPAIR.publicKey.toBase58(),
        secretKey: Array.from(E2E_CONFIG.TEST_KEYPAIR.secretKey)
      }
    }
  };
  
  try {
    writeFileSync(walletFile, JSON.stringify(walletData, null, 2));
  } catch (err) {
    console.warn('Could not write test wallet file:', err.message);
  }
  
  return {
    testDir,
    cleanup: () => {
      // Cleanup function to remove test directory
      try {
        require('fs').rmSync(testDir, { recursive: true, force: true });
      } catch (err) {
        console.warn('Test cleanup failed:', err.message);
      }
    }
  };
}

/**
 * Setup test environment variables
 */
export function setupTestEnv(testDir) {
  const originalEnv = { ...process.env };
  
  // Set test environment variables
  process.env.TELEGRAM_BOT_TOKEN = E2E_CONFIG.TEST_TELEGRAM_BOT_TOKEN;
  process.env.ZERION_API_KEY = E2E_CONFIG.TEST_ZERION_API_KEY;
  process.env.ZERION_AGENT_TOKEN = E2E_CONFIG.TEST_AGENT_TOKEN;
  process.env.SOLANA_PRIVATE_KEY = JSON.stringify(Array.from(E2E_CONFIG.TEST_KEYPAIR.secretKey));
  process.env.MAGICBLOCK_RPC_URL = E2E_CONFIG.TEST_MAGICBLOCK_RPC;
  process.env.MAGICBLOCK_EPHEMERAL_URL = E2E_CONFIG.TEST_MAGICBLOCK_EPHEMERAL;
  process.env.DATA_DIR = testDir;
  process.env.DEFAULT_WALLET = E2E_CONFIG.TEST_WALLET_NAME;
  process.env.DEFAULT_CHAIN = 'solana';
  process.env.PRIVACY_MODE = 'auto';
  process.env.PRIVACY_THRESHOLD_USD = String(E2E_CONFIG.PRIVACY_THRESHOLD);
  process.env.PRIVACY_TOKENS = 'SOL,USDC';
  process.env.LOG_LEVEL = 'warn'; // Reduce noise during tests
  process.env.PRICE_POLL_INTERVAL = String(E2E_CONFIG.POLL_INTERVAL);
  process.env.PORTFOLIO_POLL_INTERVAL = String(E2E_CONFIG.POLL_INTERVAL * 5);
  process.env.WHALE_POLL_INTERVAL = String(E2E_CONFIG.POLL_INTERVAL * 2);
  
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
 * Wait for condition with timeout
 */
export function waitFor(conditionFn, timeoutMs = E2E_CONFIG.TIMEOUT, intervalMs = 100) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const check = async () => {
      try {
        if (await conditionFn()) {
          resolve(true);
          return;
        }
      } catch (err) {
        // Continue checking on errors
      }
      
      if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Condition not met within ${timeoutMs}ms`));
        return;
      }
      
      setTimeout(check, intervalMs);
    };
    
    check();
  });
}

/**
 * Generate test price feed data
 */
export function generateTestPrices(basePrice = 100, volatility = 0.1, samples = 10) {
  const prices = [];
  let currentPrice = basePrice;
  
  for (let i = 0; i < samples; i++) {
    const change = (Math.random() - 0.5) * volatility * currentPrice;
    currentPrice = Math.max(currentPrice + change, basePrice * 0.1); // Prevent negative prices
    prices.push({
      timestamp: Date.now() + i * 1000,
      price: Number(currentPrice.toFixed(6)),
      change24h: Math.random() * 20 - 10 // -10% to +10%
    });
  }
  
  return prices;
}

/**
 * Create test trade proposal
 */
export function createTestTradeProposal(overrides = {}) {
  return {
    id: `test-${Date.now()}`,
    strategyId: 'test-strategy',
    strategyType: 'dca',
    fromToken: 'USDC',
    toToken: 'SOL',
    amount: 10,
    chain: 'solana',
    reason: 'E2E test trade',
    timestamp: Date.now(),
    ...overrides
  };
}

/**
 * Mock Telegram bot context for testing
 */
export function createMockTelegramContext(overrides = {}) {
  const mockReply = async (text, extra) => {
    console.log(`[MOCK BOT] Reply: ${text}`);
    return { message_id: Date.now() };
  };
  
  const mockEditMessage = async (text, extra) => {
    console.log(`[MOCK BOT] Edit: ${text}`);
    return { message_id: Date.now() };
  };
  
  return {
    chat: { id: E2E_CONFIG.TEST_CHAT_ID, type: 'private' },
    from: { id: E2E_CONFIG.TEST_USER_ID, username: 'testuser' },
    message: { text: '/start', message_id: Date.now() },
    reply: mockReply,
    replyWithMarkdown: mockReply,
    editMessageText: mockEditMessage,
    answerCbQuery: async (text) => console.log(`[MOCK BOT] Callback: ${text}`),
    ...overrides
  };
}

/**
 * Sleep utility for tests
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default {
  E2E_CONFIG,
  createTestEnvironment,
  setupTestEnv,
  waitFor,
  generateTestPrices,
  createTestTradeProposal,
  createMockTelegramContext,
  sleep
};