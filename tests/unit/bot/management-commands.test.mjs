import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildTitle,
  parseEveryMs,
  parsePromptSpec,
  parseScheduleParts,
} from '../../../engine/bot/commands/schedule.mjs';
import { applyPolicyMutation } from '../../../engine/bot/commands/policy.mjs';
import {
  getExecutionFailureGuidance,
  isAdvisoryExecutionFailure,
} from '../../../engine/execution/executor.mjs';

describe('schedule command parsing', () => {
  it('parses the schedule subcommand and args', () => {
    const parsed = parseScheduleParts('/schedule every 15m :: check wallet');
    assert.equal(parsed.subcommand, 'every');
    assert.deepEqual(parsed.rest, ['15m', '::', 'check', 'wallet']);
  });

  it('extracts schedule and prompt around the :: divider', () => {
    const parsed = parsePromptSpec(['*/15', '*', '*', '*', '*', '::', 'check', 'wallet']);
    assert.equal(parsed.scheduleValue, '*/15 * * * *');
    assert.equal(parsed.prompt, 'check wallet');
  });

  it('parses human-friendly intervals and title truncation', () => {
    assert.equal(parseEveryMs('30s'), 30_000);
    assert.equal(parseEveryMs('15m'), 900_000);
    assert.match(buildTitle('a'.repeat(60)), /\.\.\.$/);
  });
});

describe('policy mutation helpers', () => {
  it('updates spend, cooldown, and privacy policies in-place', () => {
    const withSpend = applyPolicyMutation({}, 'spend', ['10', '50', '100']);
    assert.deepEqual(withSpend['spend-limit'], { perTick: 10, daily: 50, total: 100 });

    const withCooldown = applyPolicyMutation(withSpend, 'cooldown', ['30']);
    assert.deepEqual(withCooldown.cooldown, { intervalMs: 30_000 });

    const withPrivacy = applyPolicyMutation(withCooldown, 'privacy', ['auto']);
    assert.deepEqual(withPrivacy.privacy, { mode: 'auto' });
  });
});

describe('autonomous execution failure guidance', () => {
  it('classifies advisory halts and returns remediation guidance', () => {
    const result = {
      advisoryHalt: true,
      errorCode: 'missing_agent_token',
      fromToken: 'SOL',
    };
    assert.equal(isAdvisoryExecutionFailure(result), true);
    assert.match(getExecutionFailureGuidance(result), /agent token/i);
  });
});
