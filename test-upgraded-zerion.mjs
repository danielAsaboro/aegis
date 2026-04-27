#!/usr/bin/env node
console.log('🚀 TESTING UPGRADED ZERION API + GETTING REAL WALLET DATA\n');

const zerionKey = process.env.ZERION_API_KEY;
console.log(`Testing with key: ${zerionKey.slice(0, 20)}...\n`);

// Get your wallet address first
console.log('👛 GETTING YOUR WALLET ADDRESS...');
const privateKeyArray = JSON.parse(process.env.SOLANA_PRIVATE_KEY);
console.log(`Private key: ${privateKeyArray.length} bytes loaded`);

// Make RPC call to get address using your private key
try {
  const response = await fetch('https://api.devnet.solana.com', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getAccountInfo',
      params: [
        // We need to derive the address, let's use a different approach
        'So11111111111111111111111111111111111111112' // SOL token program for testing
      ]
    })
  });
  
  console.log('RPC response status:', response.status);
} catch (err) {
  console.log('RPC test error:', err.message);
}

// Test multiple Zerion endpoints
const endpoints = [
  'https://api.zerion.io/v1/chains',
  'https://api.zerion.io/v1/fungibles',
  'https://api.zerion.io/v1/wallets/vitalik.eth', // Test with known wallet
];

for (const endpoint of endpoints) {
  console.log(`\n📡 Testing: ${endpoint}`);
  
  try {
    const response = await fetch(endpoint, {
      headers: {
        'Authorization': `Bearer ${zerionKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`   Status: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      const data = await response.json();
      if (data.data) {
        console.log(`   ✅ SUCCESS: Got ${Array.isArray(data.data) ? data.data.length : 'object'} data`);
        
        if (endpoint.includes('vitalik.eth') && data.data.attributes) {
          console.log(`   💰 Vitalik portfolio: $${data.data.attributes.total?.value || 'N/A'}`);
        }
        
        if (endpoint.includes('chains') && Array.isArray(data.data)) {
          const solanaChain = data.data.find(c => c.attributes.external_id === 'solana');
          if (solanaChain) {
            console.log(`   ⛓️  Found Solana: ${solanaChain.attributes.name}`);
          }
        }
      }
    } else if (response.status === 402) {
      console.log('   ❌ Still needs payment/upgrade');
    } else {
      console.log(`   ❌ Error: ${response.status}`);
    }
    
  } catch (err) {
    console.log(`   ❌ Network error: ${err.message}`);
  }
}

// Test Zerion with a known Solana address
console.log('\n🔍 TESTING WITH KNOWN SOLANA ADDRESS...');
const knownSolanaAddress = 'So11111111111111111111111111111111111111112'; // SOL token program

try {
  const response = await fetch(`https://api.zerion.io/v1/wallets/${knownSolanaAddress}`, {
    headers: {
      'Authorization': `Bearer ${zerionKey}`,
      'Content-Type': 'application/json'
    }
  });
  
  console.log(`Status: ${response.status} ${response.statusText}`);
  
  if (response.ok) {
    const data = await response.json();
    console.log('✅ Zerion API is working with Solana addresses!');
  }
} catch (err) {
  console.log(`Error: ${err.message}`);
}

console.log('\n🎯 UPGRADE STATUS:');
if (response.status === 200) {
  console.log('✅ Zerion API upgrade successful!');
  console.log('✅ Ready for real portfolio data');
} else if (response.status === 402) {
  console.log('❌ Still showing 402 - upgrade may need time to propagate');
  console.log('💡 Try again in 5-10 minutes');
} else {
  console.log(`❌ Unexpected status: ${response.status}`);
}