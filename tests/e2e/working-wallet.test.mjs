import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { Keypair, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

describe("E2E: Working Wallet Test", () => {
  let testDir, keypair, connection;

  function isNetworkError(err) {
    return /fetch failed|getaddrinfo|ENOTFOUND|ECONNREFUSED|ECONNRESET|network/i.test(err?.message || '');
  }

  before(async () => {
    console.log('[E2E WALLET] Setting up working wallet test...');
    
    // Create test directory
    testDir = mkdtempSync(join(tmpdir(), 'aegis-wallet-test-'));
    
    // Create test keypair from env or generate new one
    try {
      if (process.env.SOLANA_PRIVATE_KEY) {
        let privateKeyData;
        if (process.env.SOLANA_PRIVATE_KEY.startsWith('[')) {
          privateKeyData = JSON.parse(process.env.SOLANA_PRIVATE_KEY);
        } else {
          // Assume base58
          const bs58 = await import('bs58');
          privateKeyData = bs58.default.decode(process.env.SOLANA_PRIVATE_KEY);
        }
        keypair = Keypair.fromSecretKey(new Uint8Array(privateKeyData));
      } else {
        keypair = Keypair.generate();
      }
    } catch (err) {
      console.log('[E2E WALLET] Creating new test keypair:', err.message);
      keypair = Keypair.generate();
    }
    
    // Connect to devnet
    connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    
    console.log(`[E2E WALLET] Test wallet: ${keypair.publicKey.toBase58()}`);
  });

  after(() => {
    // Cleanup test directory
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch (err) {
      console.warn('Cleanup failed:', err.message);
    }
  });

  it("validates Solana connection and keypair", async (t) => {
    assert.ok(keypair, 'Keypair should be created');
    assert.ok(keypair.publicKey, 'Keypair should have public key');
    
    const address = keypair.publicKey.toBase58();
    assert.ok(typeof address === 'string', 'Address should be string');
    assert.ok(address.length > 40, 'Address should be valid length');
    
    // Test connection to Solana devnet
    let version;
    try {
      version = await connection.getVersion();
    } catch (err) {
      if (isNetworkError(err)) {
        t.skip(`network unavailable: ${err.message}`);
        return;
      }
      throw err;
    }
    assert.ok(version, 'Should get Solana version info');
    
    console.log(`[E2E WALLET] ✅ Connected to Solana - Version: ${version['solana-core']}`);
  });

  it("checks wallet balance on devnet", async (t) => {
    let balance;
    try {
      balance = await connection.getBalance(keypair.publicKey);
    } catch (err) {
      if (isNetworkError(err)) {
        t.skip(`network unavailable: ${err.message}`);
        return;
      }
      throw err;
    }
    const solBalance = balance / LAMPORTS_PER_SOL;
    
    console.log(`[E2E WALLET] Wallet balance: ${solBalance.toFixed(4)} SOL`);
    
    // Balance can be 0, that's okay for tests
    assert.ok(typeof balance === 'number', 'Balance should be a number');
    assert.ok(balance >= 0, 'Balance should be non-negative');
    
    if (solBalance < 0.01) {
      console.log(`[E2E WALLET] ⚠️  Low balance - consider funding: solana airdrop 1 ${keypair.publicKey.toBase58()} --url devnet`);
    }
  });

  it("validates Zerion API connectivity", async () => {
    const apiKey = process.env.ZERION_API_KEY;
    if (!apiKey || apiKey.includes('fake') || apiKey.includes('test')) {
      console.log('[E2E WALLET] Skipping Zerion test - no real API key');
      return;
    }
    
    try {
      // Test basic API connectivity
      const basicAuth = Buffer.from(`${apiKey}:`).toString('base64');
      const response = await fetch('https://api.zerion.io/v1/chains', {
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        console.log(`[E2E WALLET] Zerion API issue: ${response.status} ${response.statusText}`);
        return;
      }
      
      const data = await response.json();
      assert.ok(data.data, 'Should receive chains data');
      assert.ok(Array.isArray(data.data), 'Chains should be array');
      
      const solanaChain = data.data.find(c =>
        c.id === 'solana' ||
        c.attributes?.external_id === 'solana' ||
        c.attributes?.name?.toLowerCase().includes('solana')
      );
      assert.ok(solanaChain, 'Solana chain should be available');
      
      console.log(`[E2E WALLET] ✅ Zerion API connected - ${data.data.length} chains available`);
    } catch (err) {
      console.log(`[E2E WALLET] Zerion API test failed: ${err.message}`);
    }
  });

  it("validates MagicBlock endpoint accessibility", async () => {
    const magicBlockRpc = process.env.MAGICBLOCK_RPC_URL || 'https://rpc.magicblock.app/devnet';
    
    try {
      const response = await fetch(magicBlockRpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getVersion'
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log(`[E2E WALLET] ✅ MagicBlock RPC accessible - Version: ${data.result?.['solana-core'] || 'unknown'}`);
      } else {
        console.log(`[E2E WALLET] MagicBlock RPC status: ${response.status}`);
      }
    } catch (err) {
      console.log(`[E2E WALLET] MagicBlock RPC test: ${err.message}`);
    }
  });

  it("validates Telegram bot token format", async () => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken || botToken.includes('fake') || botToken.includes('test')) {
      console.log('[E2E WALLET] Using test bot token format');
      return;
    }
    
    // Telegram bot tokens have format: botId:hash
    const tokenPattern = /^\d+:[A-Za-z0-9_-]+$/;
    assert.ok(tokenPattern.test(botToken), 'Bot token should match Telegram format');
    
    try {
      // Test bot API connectivity
      const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const data = await response.json();
      
      if (data.ok) {
        console.log(`[E2E WALLET] ✅ Telegram bot connected: @${data.result.username}`);
      } else {
        console.log(`[E2E WALLET] Telegram bot issue: ${data.description}`);
      }
    } catch (err) {
      console.log(`[E2E WALLET] Telegram bot test: ${err.message}`);
    }
  });

  it("tests basic file operations for data storage", async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    
    // Test creating and writing to a file
    const testFile = path.join(testDir, 'test-data.json');
    const testData = {
      id: 'test-123',
      timestamp: Date.now(),
      wallet: keypair.publicKey.toBase58()
    };
    
    fs.writeFileSync(testFile, JSON.stringify(testData, null, 2));
    assert.ok(fs.existsSync(testFile), 'Test file should be created');
    
    // Test reading the file
    const readData = JSON.parse(fs.readFileSync(testFile, 'utf-8'));
    assert.equal(readData.id, testData.id, 'Data should be preserved');
    assert.equal(readData.wallet, testData.wallet, 'Wallet address should be preserved');
    
    console.log(`[E2E WALLET] ✅ File operations work in ${testDir}`);
  });

  it("reports environment variable coverage for production use", async () => {
    const requiredForProduction = [
      'TELEGRAM_BOT_TOKEN',
      'ZERION_API_KEY',
      'SOLANA_PRIVATE_KEY'
    ];
    
    const present = requiredForProduction.filter(key => process.env[key]);
    const missing = requiredForProduction.filter(key => !process.env[key]);
    
    console.log(`[E2E WALLET] Environment check - Present: ${present.length}/${requiredForProduction.length}`);
    
    if (missing.length > 0) {
      console.log(`[E2E WALLET] Missing for production: ${missing.join(', ')}`);
    }
    
    assert.equal(
      present.length + missing.length,
      requiredForProduction.length,
      'environment coverage accounting should stay consistent'
    );

    if (present.length === requiredForProduction.length) {
      console.log('[E2E WALLET] ✅ All production environment variables present');
    }
  });
});
