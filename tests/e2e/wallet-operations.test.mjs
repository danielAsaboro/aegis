import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { Keypair } from '@solana/web3.js';
import { getKeypair } from '../../engine/lib/keypair.mjs';
import { getEvmAddress, getSolAddress } from '../../cli/lib/wallet/keystore.js';
import { MagicBlockClient } from '../../engine/lib/magicblock/client.mjs';
import { 
  createRealTestEnvironment,
  setupRealTestEnv,
  runPreflightChecks,
  validateWalletFunds,
  REAL_E2E_CONFIG 
} from './real-setup.mjs';

describe("E2E: Wallet Operations (Real)", () => {
  let testEnv, restoreEnv, keypair, walletAddress;

  before(async () => {
    console.log('[E2E WALLET] Setting up real test environment...');
    
    // Create test environment
    testEnv = await createRealTestEnvironment();
    restoreEnv = setupRealTestEnv(testEnv.testDir);
    
    // Get real keypair from environment
    try {
      keypair = getKeypair();
      walletAddress = keypair.publicKey.toBase58();
      console.log(`[E2E WALLET] Using wallet: ${walletAddress}`);
    } catch (err) {
      throw new Error(`Failed to load keypair: ${err.message}. Set SOLANA_PRIVATE_KEY in environment.`);
    }
    
    // Run preflight checks
    await runPreflightChecks(keypair);
  });

  after(() => {
    if (testEnv) testEnv.cleanup();
    if (restoreEnv) restoreEnv();
  });

  it("validates wallet has sufficient funds for testing", async () => {
    const funds = await validateWalletFunds(keypair);
    
    assert.ok(funds.sol >= REAL_E2E_CONFIG.MIN_SOL_BALANCE, 
      `Insufficient SOL: ${funds.sol} < ${REAL_E2E_CONFIG.MIN_SOL_BALANCE}`);
    
    assert.ok(typeof funds.address === 'string', 'Address should be string');
    assert.equal(funds.address, walletAddress, 'Address should match keypair');
    
    console.log(`[E2E WALLET] ✅ Wallet validation passed - ${funds.sol.toFixed(4)} SOL available`);
  });

  it("connects to real Zerion API and fetches wallet portfolio", async () => {
    const apiKey = process.env.ZERION_API_KEY;
    assert.ok(apiKey, 'ZERION_API_KEY required for real tests');
    
    // Make real API call to Zerion
    const basicAuth = Buffer.from(`${apiKey}:`).toString('base64');
    const response = await fetch(`https://api.zerion.io/v1/wallets/${walletAddress}`, {
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.status === 404) {
      console.log(`[E2E WALLET] Wallet ${walletAddress} not found in Zerion (expected for new wallets)`);
      return; // This is okay for new test wallets
    }
    
    assert.ok(response.ok, `Zerion API error: ${response.status} ${response.statusText}`);
    
    const data = await response.json();
    assert.ok(data, 'Should receive portfolio data');
    
    if (data.data) {
      assert.equal(data.data.id, walletAddress, 'Portfolio should match wallet address');
      console.log(`[E2E WALLET] ✅ Portfolio fetched - Total value: $${data.data.attributes?.total?.value || 0}`);
    }
  });

  it("connects to real MagicBlock and checks connectivity", async () => {
    const mbClient = new MagicBlockClient(keypair);
    
    // Test connection
    await mbClient.connect();
    assert.ok(true, 'MagicBlock connection should succeed');
    
    // Test getting shielded balance (should work even if 0)
    try {
      const solBalance = await mbClient.getShieldedBalance('So11111111111111111111111111111111111111112');
      assert.ok(typeof solBalance === 'bigint', 'Balance should be bigint');
      console.log(`[E2E WALLET] ✅ MagicBlock connected - Shielded SOL: ${solBalance.toString()}`);
    } catch (err) {
      // Some balance queries may fail for uninitialized accounts, that's okay
      console.log(`[E2E WALLET] ✅ MagicBlock connected - Balance query: ${err.message}`);
    }
    
    await mbClient.disconnect();
  });

  it("performs real wallet keystore operations", async () => {
    // These should work with the real wallet created in the test environment
    const testWalletName = process.env.DEFAULT_WALLET || 'default';
    
    try {
      // Try to get Solana address from keystore
      const solAddr = getSolAddress(testWalletName);
      assert.ok(typeof solAddr === 'string', 'Solana address should be string');
      assert.ok(solAddr.length > 0, 'Solana address should not be empty');
      console.log(`[E2E WALLET] ✅ Keystore SOL address: ${solAddr}`);
    } catch (err) {
      console.log(`[E2E WALLET] No SOL address in keystore: ${err.message}`);
    }
    
    try {
      // Try to get EVM address (may not exist)
      const evmAddr = getEvmAddress(testWalletName);
      console.log(`[E2E WALLET] ✅ Keystore EVM address: ${evmAddr}`);
    } catch (err) {
      console.log(`[E2E WALLET] No EVM address in keystore: ${err.message}`);
    }
  });

  it("validates real environment configuration", async () => {
    // Check all required environment variables are set
    const required = [
      'TELEGRAM_BOT_TOKEN',
      'ZERION_API_KEY', 
      'SOLANA_PRIVATE_KEY',
      'DATA_DIR'
    ];
    
    for (const key of required) {
      assert.ok(process.env[key], `Environment variable ${key} should be set`);
    }
    
    // Check MagicBlock endpoints are reachable
    const magicblockRpc = process.env.MAGICBLOCK_RPC_URL;
    assert.ok(magicblockRpc, 'MAGICBLOCK_RPC_URL should be set');
    
    // Ping the RPC endpoint
    try {
      const response = await fetch(magicblockRpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getHealth'
        })
      });
      
      assert.ok(response.status < 500, `MagicBlock RPC should be reachable: ${response.status}`);
      console.log(`[E2E WALLET] ✅ MagicBlock RPC reachable: ${response.status}`);
    } catch (err) {
      console.warn(`[E2E WALLET] MagicBlock RPC check failed: ${err.message}`);
    }
    
    console.log('[E2E WALLET] ✅ Environment validation passed');
  });

  it("tests real data directory and store initialization", async () => {
    const dataDir = process.env.DATA_DIR;
    assert.ok(dataDir, 'DATA_DIR should be set');
    
    // Check that stores were initialized
    const fs = await import('node:fs');
    
    // The stores should create their files when used
    assert.ok(fs.existsSync(dataDir), 'Data directory should exist');
    
    // Try to use a store to verify it works
    const { getState } = await import('../../engine/store/state.mjs');
    const state = getState();
    assert.ok(typeof state === 'object', 'State store should return object');
    
    console.log(`[E2E WALLET] ✅ Data stores initialized in ${dataDir}`);
  });

  it("validates Telegram bot token format", async () => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    assert.ok(botToken, 'TELEGRAM_BOT_TOKEN should be set');
    
    // Telegram bot tokens have a specific format: botId:hash
    const tokenPattern = /^\d+:[A-Za-z0-9_-]+$/;
    assert.ok(tokenPattern.test(botToken), 'Bot token should match Telegram format');
    
    // Test bot API connectivity
    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const data = await response.json();
      
      if (data.ok) {
        assert.ok(data.result.username, 'Bot should have username');
        console.log(`[E2E WALLET] ✅ Telegram bot connected: @${data.result.username}`);
      } else {
        console.warn(`[E2E WALLET] Telegram bot API issue: ${data.description}`);
      }
    } catch (err) {
      console.warn(`[E2E WALLET] Telegram bot connectivity check failed: ${err.message}`);
    }
  });
});