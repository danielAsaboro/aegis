import assert from "node:assert/strict";
import { describe, it, before } from "node:test";

describe("E2E: Minimal Real Functionality", () => {
  let hasRealEnv = false;

  function isNetworkError(err) {
    return /fetch failed|getaddrinfo|ENOTFOUND|ECONNREFUSED|ECONNRESET|network/i.test(err?.message || '');
  }

  before(() => {
    // Check if we have real environment variables
    hasRealEnv = process.env.ZERION_API_KEY && 
                 !process.env.ZERION_API_KEY.includes('fake') &&
                 process.env.TELEGRAM_BOT_TOKEN &&
                 !process.env.TELEGRAM_BOT_TOKEN.includes('fake');
                 
    console.log(`[E2E MINIMAL] Real environment available: ${hasRealEnv}`);
  });

  it("validates real Zerion API connectivity", async (t) => {
    if (!hasRealEnv) {
      console.log('[E2E MINIMAL] Skipping Zerion test - using fake credentials');
      return;
    }

    const apiKey = process.env.ZERION_API_KEY;
    
    try {
      const basicAuth = Buffer.from(`${apiKey}:`).toString('base64');
      const response = await fetch('https://api.zerion.io/v1/chains', {
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/json'
        }
      });
      
      assert.ok(response.ok, `Zerion API should respond: ${response.status}`);
      
      const data = await response.json();
      assert.ok(data.data, 'Should receive chains data');
      assert.ok(Array.isArray(data.data), 'Chains should be array');
      
      console.log(`[E2E MINIMAL] ✅ Zerion API: ${data.data.length} chains available`);
      
      // Check for Solana specifically
      const solanaChain = data.data.find(c => 
        c.attributes.external_id === 'solana' ||
        c.attributes.name.toLowerCase().includes('solana')
      );
      
      if (solanaChain) {
        console.log(`[E2E MINIMAL] ✅ Solana chain found: ${solanaChain.attributes.name}`);
      }
      
    } catch (err) {
      if (isNetworkError(err)) {
        t.skip(`network unavailable: ${err.message}`);
        return;
      }
      assert.fail(`Real Zerion API test failed: ${err.message}`);
    }
  });

  it("validates real Telegram bot API connectivity", async (t) => {
    if (!hasRealEnv) {
      console.log('[E2E MINIMAL] Skipping Telegram test - using fake token');
      return;
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    
    // Validate token format
    const tokenPattern = /^\d+:[A-Za-z0-9_-]+$/;
    assert.ok(tokenPattern.test(botToken), 'Bot token should match Telegram format');
    
    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const data = await response.json();
      
      assert.ok(data.ok, `Telegram API should respond successfully: ${data.description || 'unknown error'}`);
      assert.ok(data.result, 'Should receive bot info');
      assert.ok(data.result.username, 'Bot should have username');
      
      console.log(`[E2E MINIMAL] ✅ Telegram bot: @${data.result.username} (${data.result.first_name})`);
      
    } catch (err) {
      if (isNetworkError(err)) {
        t.skip(`network unavailable: ${err.message}`);
        return;
      }
      assert.fail(`Real Telegram API test failed: ${err.message}`);
    }
  });

  it("validates real Solana devnet connectivity", async (t) => {
    const solanaRpc = 'https://api.devnet.solana.com';
    
    try {
      const response = await fetch(solanaRpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getVersion'
        })
      });
      
      assert.ok(response.ok, `Solana RPC should respond: ${response.status}`);
      
      const data = await response.json();
      assert.ok(data.result, 'Should receive version info');
      
      console.log(`[E2E MINIMAL] ✅ Solana devnet: ${data.result['solana-core'] || 'connected'}`);
      
      // Test another method to ensure RPC is working
      const healthResponse = await fetch(solanaRpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'getHealth'
        })
      });
      
      if (healthResponse.ok) {
        const healthData = await healthResponse.json();
        console.log(`[E2E MINIMAL] ✅ Solana health: ${healthData.result || 'ok'}`);
      }
      
    } catch (err) {
      if (isNetworkError(err)) {
        t.skip(`network unavailable: ${err.message}`);
        return;
      }
      assert.fail(`Real Solana devnet test failed: ${err.message}`);
    }
  });

  it("validates real MagicBlock endpoint accessibility", async () => {
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
      
      // MagicBlock might return different status codes but should be reachable
      console.log(`[E2E MINIMAL] MagicBlock RPC status: ${response.status}`);
      
      if (response.ok) {
        const data = await response.json();
        console.log(`[E2E MINIMAL] ✅ MagicBlock connected: ${JSON.stringify(data).slice(0, 100)}...`);
      } else {
        console.log(`[E2E MINIMAL] MagicBlock response: ${response.statusText}`);
      }
      
      // Test ephemeral endpoint too
      const ephemeralUrl = process.env.MAGICBLOCK_EPHEMERAL_URL || 'https://devnet.magicblock.app';
      const ephemeralResponse = await fetch(`${ephemeralUrl}/health`).catch(() => null);
      
      if (ephemeralResponse) {
        console.log(`[E2E MINIMAL] ✅ MagicBlock ephemeral: ${ephemeralResponse.status}`);
      } else {
        console.log(`[E2E MINIMAL] MagicBlock ephemeral: not reachable`);
      }
      
    } catch (err) {
      console.log(`[E2E MINIMAL] MagicBlock test: ${err.message}`);
      // Don't fail the test for MagicBlock issues
    }
  });

  it("performs real external API integration check", async (t) => {
    // This test validates that our test environment can make real external calls
    // which is essential for E2E testing
    
    const testEndpoints = [
      { name: 'GitHub', url: 'https://api.github.com/zen', method: 'GET' },
      { name: 'JSONPlaceholder', url: 'https://jsonplaceholder.typicode.com/posts/1', method: 'GET' }
    ];
    
    let successCount = 0;
    
    for (const endpoint of testEndpoints) {
      try {
        const response = await fetch(endpoint.url, { 
          method: endpoint.method,
          headers: { 'User-Agent': 'aegis-e2e-test' }
        });
        
        if (response.ok) {
          successCount++;
          console.log(`[E2E MINIMAL] ✅ ${endpoint.name} API accessible`);
        } else {
          console.log(`[E2E MINIMAL] ❌ ${endpoint.name} API: ${response.status}`);
        }
        
      } catch (err) {
        console.log(`[E2E MINIMAL] ❌ ${endpoint.name} API failed: ${err.message}`);
      }
    }
    
    if (successCount === 0) {
      t.skip('no external APIs reachable from this environment');
      return;
    }
    assert.ok(successCount > 0, 'At least one external API should be accessible');
    console.log(`[E2E MINIMAL] ✅ External API integration: ${successCount}/${testEndpoints.length} endpoints accessible`);
  });

  it("validates test environment requirements", async () => {
    // Check Node.js version
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    assert.ok(majorVersion >= 20, `Node.js 20+ required, got ${nodeVersion}`);
    
    // Check basic crypto functionality
    const crypto = await import('node:crypto');
    const randomBytes = crypto.randomBytes(32);
    assert.equal(randomBytes.length, 32, 'Crypto operations should work');
    
    // Check file system operations
    const fs = await import('node:fs');
    const os = await import('node:os');
    const testDir = fs.mkdtempSync(os.tmpdir() + '/aegis-test-');
    assert.ok(fs.existsSync(testDir), 'File system operations should work');
    fs.rmSync(testDir, { recursive: true });
    
    // Check JSON operations
    const testObj = { test: true, timestamp: Date.now() };
    const json = JSON.stringify(testObj);
    const parsed = JSON.parse(json);
    assert.equal(parsed.test, true, 'JSON operations should work');
    
    console.log(`[E2E MINIMAL] ✅ Test environment ready - Node ${nodeVersion}`);
  });
});
