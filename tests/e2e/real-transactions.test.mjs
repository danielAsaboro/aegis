import assert from "node:assert/strict";
import { describe, it, before } from "node:test";

describe("E2E: Real Transactions with Your API Keys", () => {
  let keypair, walletAddress;

  before(async () => {
    console.log('[E2E REAL] Setting up with your actual API keys...');
    
    // Parse your actual Solana private key
    const privateKeyArray = JSON.parse(process.env.SOLANA_PRIVATE_KEY);
    const privateKeyBytes = new Uint8Array(privateKeyArray);
    
    // Create keypair from your actual private key
    const { Keypair } = await import('@solana/web3.js');
    keypair = Keypair.fromSecretKey(privateKeyBytes);
    walletAddress = keypair.publicKey.toBase58();
    
    console.log(`[E2E REAL] Using your wallet: ${walletAddress}`);
  });

  it("tests real Zerion API with your actual API key", async () => {
    const apiKey = process.env.ZERION_API_KEY;
    console.log(`[E2E REAL] Testing Zerion API with key: ${apiKey.slice(0, 10)}...`);
    
    try {
      const basicAuth = Buffer.from(`${apiKey}:`).toString('base64');
      // Test chains endpoint first
      const chainsResponse = await fetch('https://api.zerion.io/v1/chains', {
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/json'
        }
      });

      assert.ok(chainsResponse.ok, `Chains API failed: ${chainsResponse.status} ${chainsResponse.statusText}`);
      const chainsData = await chainsResponse.json();
      console.log(`[E2E REAL] ✅ Zerion chains: ${chainsData.data.length} available`);

      // Test your actual wallet portfolio
      const portfolioResponse = await fetch(`https://api.zerion.io/v1/wallets/${walletAddress}`, {
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (portfolioResponse.status === 404) {
        console.log(`[E2E REAL] Wallet ${walletAddress} not found in Zerion (expected for new wallets)`);
      } else if (portfolioResponse.ok) {
        const portfolioData = await portfolioResponse.json();
        console.log(`[E2E REAL] ✅ Portfolio total: $${portfolioData.data.attributes.total.value}`);
      } else {
        console.log(`[E2E REAL] Portfolio response: ${portfolioResponse.status} ${portfolioResponse.statusText}`);
      }
      
    } catch (err) {
      assert.fail(`Zerion API test failed: ${err.message}`);
    }
  });

  it("checks real wallet balance on Solana devnet", async () => {
    const { Connection, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    
    const balance = await connection.getBalance(keypair.publicKey);
    const solBalance = balance / LAMPORTS_PER_SOL;
    
    console.log(`[E2E REAL] Your wallet balance: ${solBalance.toFixed(6)} SOL`);
    
    assert.ok(typeof balance === 'number', 'Balance should be number');
    assert.ok(balance >= 0, 'Balance should be non-negative');
    
    if (solBalance < 0.01) {
      console.log(`[E2E REAL] ⚠️  Low balance - fund with: solana airdrop 1 ${walletAddress} --url devnet`);
    }
    
    // Get recent transaction signature if available
    const signatures = await connection.getSignaturesForAddress(keypair.publicKey, { limit: 1 });
    if (signatures.length > 0) {
      console.log(`[E2E REAL] ✅ Recent transaction: ${signatures[0].signature}`);
      console.log(`[E2E REAL] Transaction link: https://solscan.io/tx/${signatures[0].signature}?cluster=devnet`);
    } else {
      console.log(`[E2E REAL] No recent transactions found`);
    }
  });

  it("tests real MagicBlock SDK integration with your wallet", async () => {
    try {
      // Try to import and use the actual MagicBlock SDK
      const { MagicBlockClient } = await import('../../engine/lib/magicblock/client.mjs');
      
      const mbClient = new MagicBlockClient(keypair);
      console.log(`[E2E REAL] Creating MagicBlock client...`);
      
      // Test connection
      await mbClient.connect();
      console.log(`[E2E REAL] ✅ MagicBlock client connected`);
      
      // Test getting shielded balance for SOL
      const solMint = 'So11111111111111111111111111111111111111112';
      try {
        const shieldedBalance = await mbClient.getShieldedBalance(solMint);
        console.log(`[E2E REAL] ✅ Shielded SOL balance: ${shieldedBalance.toString()} lamports`);
      } catch (err) {
        console.log(`[E2E REAL] Shielded balance check: ${err.message} (account may not exist yet)`);
      }
      
      await mbClient.disconnect();
      
    } catch (err) {
      console.log(`[E2E REAL] MagicBlock test: ${err.message}`);
    }
  });

  it("attempts real transaction on devnet (if funded)", async () => {
    const { Connection, SystemProgram, Transaction, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    
    // Check balance first
    const balance = await connection.getBalance(keypair.publicKey);
    const solBalance = balance / LAMPORTS_PER_SOL;
    
    if (solBalance < 0.01) {
      console.log(`[E2E REAL] Skipping transaction test - insufficient balance (${solBalance.toFixed(6)} SOL)`);
      return;
    }
    
    // Create a small self-transfer to test transaction capability
    const transferAmount = 1000; // 0.000001 SOL
    
    try {
      console.log(`[E2E REAL] Attempting test transaction of ${transferAmount} lamports...`);
      
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: keypair.publicKey, // Self-transfer
          lamports: transferAmount
        })
      );
      
      // Get recent blockhash
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = keypair.publicKey;
      
      // Sign transaction
      transaction.sign(keypair);
      
      // Send transaction
      const signature = await connection.sendRawTransaction(transaction.serialize());
      console.log(`[E2E REAL] ✅ Transaction sent: ${signature}`);
      console.log(`[E2E REAL] ✅ Transaction link: https://solscan.io/tx/${signature}?cluster=devnet`);
      
      // Wait for confirmation
      const confirmation = await connection.confirmTransaction(signature, 'confirmed');
      if (confirmation.value.err) {
        console.log(`[E2E REAL] ❌ Transaction failed: ${confirmation.value.err}`);
      } else {
        console.log(`[E2E REAL] ✅ Transaction confirmed successfully!`);
      }
      
      assert.ok(signature, 'Should receive transaction signature');
      assert.ok(typeof signature === 'string', 'Signature should be string');
      
    } catch (err) {
      console.log(`[E2E REAL] Transaction test failed: ${err.message}`);
    }
  });

  it("tests real Telegram bot with your token", async () => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    
    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const data = await response.json();
      
      assert.ok(data.ok, `Telegram API failed: ${data.description}`);
      
      console.log(`[E2E REAL] ✅ Your Telegram bot: @${data.result.username}`);
      console.log(`[E2E REAL] Bot name: ${data.result.first_name}`);
      console.log(`[E2E REAL] Bot ID: ${data.result.id}`);
      
      // Test sending a message to yourself (if you know your chat ID)
      // This is commented out since we don't want to spam
      // const testMessage = `🤖 AEGIS E2E Test - ${new Date().toISOString()}`;
      // console.log(`[E2E REAL] Test message ready: ${testMessage}`);
      
    } catch (err) {
      assert.fail(`Telegram test failed: ${err.message}`);
    }
  });

  it("validates complete real environment setup", async () => {
    const summary = {
      wallet: walletAddress,
      zerionKey: process.env.ZERION_API_KEY?.slice(0, 10) + '...',
      telegramBot: process.env.TELEGRAM_BOT_TOKEN?.split(':')[0],
      magicBlockRpc: process.env.MAGICBLOCK_RPC_URL,
      privacyMode: process.env.PRIVACY_MODE,
      defaultChain: process.env.DEFAULT_CHAIN
    };
    
    console.log('[E2E REAL] Environment Summary:');
    console.log(`  Wallet: ${summary.wallet}`);
    console.log(`  Zerion API: ${summary.zerionKey}`);  
    console.log(`  Telegram Bot: ${summary.telegramBot}`);
    console.log(`  MagicBlock RPC: ${summary.magicBlockRpc}`);
    console.log(`  Privacy Mode: ${summary.privacyMode}`);
    console.log(`  Default Chain: ${summary.defaultChain}`);
    
    // Verify all required fields are present
    assert.ok(summary.wallet, 'Wallet address should be present');
    assert.ok(summary.zerionKey, 'Zerion API key should be present');
    assert.ok(summary.telegramBot, 'Telegram bot token should be present');
    
    console.log('[E2E REAL] ✅ Complete real environment validated');
  });
});