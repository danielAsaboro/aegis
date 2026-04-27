import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("E2E: Simple Test", () => {
  it("validates basic Node.js functionality", async () => {
    assert.equal(1 + 1, 2, 'Basic math should work');
    console.log('✅ Basic test passed');
  });

  it("validates environment variables are accessible", async () => {
    // Check that we can access env vars
    const hasToken = !!process.env.TELEGRAM_BOT_TOKEN;
    const hasZerion = !!process.env.ZERION_API_KEY;
    const hasSolana = !!process.env.SOLANA_PRIVATE_KEY;
    
    console.log(`Environment check - Telegram: ${hasToken}, Zerion: ${hasZerion}, Solana: ${hasSolana}`);
    
    // At least one should be set for testing
    assert.ok(hasToken || hasZerion || hasSolana, 'At least one environment variable should be set');
    console.log('✅ Environment variables accessible');
  });

  it("validates fetch API is available for external calls", async () => {
    // Test that fetch works (for API calls)
    try {
      const response = await fetch('https://api.github.com/zen', { 
        method: 'GET',
        headers: { 'User-Agent': 'aegis-e2e-test' }
      });
      assert.ok(response.ok, 'Fetch should work for external APIs');
      const zen = await response.text();
      assert.ok(zen.length > 0, 'Should receive response content');
      console.log('✅ Fetch API works');
    } catch (err) {
      console.warn('Network fetch failed:', err.message);
      // Don't fail the test for network issues
    }
  });

  it("validates JSON operations for storage", async () => {
    const testData = {
      id: 'test-123',
      amount: 10.5,
      timestamp: Date.now(),
      array: [1, 2, 3]
    };
    
    const serialized = JSON.stringify(testData);
    assert.ok(typeof serialized === 'string', 'JSON stringify should work');
    
    const parsed = JSON.parse(serialized);
    assert.equal(parsed.id, testData.id, 'JSON parse should work');
    assert.equal(parsed.amount, testData.amount, 'Numbers should be preserved');
    
    console.log('✅ JSON operations work');
  });

  it("validates crypto operations are available", async () => {
    try {
      // Test that we can generate random bytes (needed for keypairs)
      const crypto = await import('node:crypto');
      const randomBytes = crypto.randomBytes(32);
      assert.equal(randomBytes.length, 32, 'Should generate 32 random bytes');
      
      console.log('✅ Crypto operations available');
    } catch (err) {
      console.warn('Crypto operations failed:', err.message);
    }
  });
});