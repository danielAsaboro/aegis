import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const { buildSystemPrompt } = await import('../../../engine/agent/system-prompt.mjs');

describe('agent system prompt', () => {
  test('tells the agent to use active wallet defaults before asking for wallet state', () => {
    const prompt = buildSystemPrompt({
      walletName: 'demo',
      walletAddress: 'DemoAddress111',
      defaultChain: 'solana',
    });

    assert.match(prompt, /Active wallet: demo \(DemoAddress111\)/);
    assert.match(prompt, /Default chain: solana/);
    assert.match(prompt, /omit walletName to use the active wallet/);
    assert.match(prompt, /Never ask the user to provide their wallet name, chain, token list, balances, positions, or holdings before trying the read-only tools/);
    assert.match(prompt, /For DCA, rebalance, status, and "tokens I hold" requests, fetch current holdings with getPositions before asking follow-up questions/);
  });

  test('tells the agent to use memory safely for notes, plans, issues, and prior work', () => {
    const prompt = buildSystemPrompt();

    assert.match(prompt, /Load the memory-orchestration skill/);
    assert.match(prompt, /open issues, fixed bugs, proof constraints, and durable project lessons/);
    assert.match(prompt, /Never store private keys, seed phrases, API keys, passphrases, OTPs, or raw secrets/);
    assert.match(prompt, /Memory is not proof of current onchain state/);
  });

  test('targets Telegram-native replies without markdown artifacts', () => {
    const prompt = buildSystemPrompt();

    assert.match(prompt, /Write for Telegram/);
    assert.match(prompt, /Do not emit Markdown syntax for normal replies/);
    assert.match(prompt, /Reserve inline code only for exact commands, tx hashes, env vars, file paths, and machine IDs/);
  });
});
