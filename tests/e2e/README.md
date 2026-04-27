# AEGIS End-to-End Tests

Real end-to-end tests that validate the complete user journey from wallet setup through trading execution, using actual APIs and services.

## Overview

These tests validate the entire AEGIS system using **real services** - no mocks, stubs, or placeholders. They test:

- **Real Zerion API** calls for portfolio and transaction data
- **Real MagicBlock** integration for privacy features  
- **Real Solana devnet** transactions
- **Real Telegram bot** command processing
- **Real policy enforcement** and strategy execution

## Test Flows

### Flow A: Wallet Operations (`wallet-operations.test.mjs`)
- Validates wallet has sufficient funds for testing
- Tests real Zerion API connectivity and portfolio fetching
- Verifies MagicBlock connection and shielded balance queries
- Validates environment configuration and keystore operations

### Flow B: DCA Strategy (`dca-strategy.test.mjs`)
- Creates real DCA plans with actual policy validation
- Tests scheduler integration and plan persistence
- Simulates Telegram bot command processing
- Validates privacy flag handling and plan management

### Flow C: Privacy Trading (`privacy-trading.test.mjs`)
- Tests privacy policy routing decisions
- Performs real MagicBlock shield deposits/withdrawals
- Validates shielded balance tracking
- Tests private vs public execution routing

### Flow D: Group Consensus (`group-consensus.test.mjs`)
- Creates trade proposals requiring group votes
- Simulates multi-user voting workflow
- Tests consensus policy enforcement
- Validates proposal expiration and persistence

### Flow E: Signal Automation (`signal-automation.test.mjs`)
- Tests real price monitoring and signal generation
- Validates strategy responses to price dips/spikes
- Tests portfolio monitoring with Zerion API
- Validates event bus signal routing

## Prerequisites

### Required Environment Variables

```bash
# Core requirements
TELEGRAM_BOT_TOKEN=       # From @BotFather
ZERION_API_KEY=          # From dashboard.zerion.io  
SOLANA_PRIVATE_KEY=      # Base58 or JSON array

# Optional for enhanced testing
TEST_WALLET_ADDRESS=     # Existing wallet with portfolio for testing
ACTUALLY_SEND_TELEGRAM_MESSAGES=false  # Set to 'true' to send real messages
```

### Wallet Funding

Tests require a funded devnet wallet:

```bash
# Fund your test wallet
solana airdrop 1 <YOUR_WALLET_ADDRESS> --url devnet

# Minimum balances needed:
# - 0.1 SOL for transaction fees and shield testing
# - Small amounts of USDC helpful for trade testing
```

### API Access

1. **Zerion API Key**: Get from [dashboard.zerion.io](https://dashboard.zerion.io)
2. **Telegram Bot**: Create via [@BotFather](https://t.me/BotFather)
3. **MagicBlock**: Uses public devnet endpoints

## Running Tests

### All E2E Tests
```bash
pnpm test:e2e
```

### Individual Test Flows
```bash
pnpm test:e2e:wallet      # Wallet operations
pnpm test:e2e:dca         # DCA strategy  
pnpm test:e2e:privacy     # Privacy trading
pnpm test:e2e:consensus   # Group consensus
pnpm test:e2e:signals     # Signal automation
```

### Complete Test Suite
```bash
pnpm test:all    # Unit + Integration + E2E
```

## Test Environment

Tests create isolated environments:
- **Temporary data directories** for each test run
- **Real API calls** with test-specific configurations
- **Devnet transactions** using small amounts
- **Test message capture** (Telegram messages logged, not sent by default)

## Expected Behavior

### Successful Test Run
```
[E2E WALLET] ✅ Wallet validation passed - 0.5000 SOL available
[E2E WALLET] ✅ Portfolio fetched - Total value: $75.50
[E2E DCA] ✅ Created real DCA plan: dca-1234 - $1 SOL every 30s
[E2E PRIVACY] ✅ Deposit successful - TX: 5KJQz...
[E2E CONSENSUS] ✅ Consensus proposal: prop-5678 - $25 SOL
[E2E SIGNALS] ✅ Price signal received: SOL = $150.07 (+3.2%)
```

### Common Issues

**Insufficient Funds**
```
Error: Insufficient SOL balance for testing. Required: 0.1 SOL, Current: 0.0050 SOL
Fund wallet: solana airdrop 1 <address> --url devnet
```

**Invalid API Key**
```
Error: Zerion API validation failed: Authentication failed: Invalid API key
```

**Network Issues**
```
Warning: MagicBlock connection check failed: Connection timeout
```

## Test Data

Tests use small amounts for safety:
- **DCA amounts**: $1 per execution
- **Trade amounts**: $0.50 per trade  
- **Shield deposits**: 0.001 SOL
- **Privacy threshold**: $100 (configurable)

## Network Requirements

Tests connect to:
- **Solana Devnet**: `https://api.devnet.solana.com`
- **MagicBlock RPC**: `https://rpc.magicblock.app/devnet`
- **Zerion API**: `https://api.zerion.io/v1`
- **Telegram API**: `https://api.telegram.org`

## Safety Features

- **Devnet only**: No mainnet transactions
- **Small amounts**: Minimal value at risk
- **Test isolation**: Each test uses separate data
- **Cleanup**: Automatic cleanup of test resources
- **Timeouts**: Tests fail safely if APIs are unresponsive

## Contributing

When adding new E2E tests:

1. **Use real services** - no mocks or stubs
2. **Test small amounts** - keep financial risk minimal  
3. **Handle failures gracefully** - network issues shouldn't crash tests
4. **Clean up resources** - remove test data after completion
5. **Document requirements** - update prerequisites if needed

## Debugging

### Verbose Logging
```bash
LOG_LEVEL=debug pnpm test:e2e:wallet
```

### Network Debugging
```bash
# Test individual API endpoints
curl -H "Authorization: Bearer $ZERION_API_KEY" https://api.zerion.io/v1/chains
curl -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getVersion"}' $MAGICBLOCK_RPC_URL
```

### Skip Network Tests
Set `SKIP_NETWORK_TESTS=true` to skip tests requiring external API calls.

---

These E2E tests provide comprehensive validation of AEGIS functionality using real services and APIs, ensuring the system works end-to-end in production-like conditions.