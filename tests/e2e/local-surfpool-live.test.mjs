import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';

const ROOT = new URL('../../', import.meta.url);

function runLocal(args) {
  const child = spawnSync(
    process.execPath,
    ['--env-file=.env.local', 'scripts/local-mode.mjs', ...args],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, AEGIS_LOCAL_SURFPOOL_MODE: '1' },
    }
  );
  return child;
}

function parseLastJson(text) {
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] !== '{') continue;
    try {
      return JSON.parse(text.slice(i));
    } catch {}
  }
  throw new SyntaxError(`Could not find trailing JSON in output:\n${text}`);
}

describe('AEGIS surfpool local mode', { timeout: 120_000 }, () => {
  it('bootstraps an isolated local wallet/profile', () => {
    const child = runLocal(['bootstrap', '--json']);
    assert.equal(child.status, 0, child.stderr);
    const payload = parseLastJson(child.stdout);
    assert.equal(payload.walletName, 'proof-local');
    assert.equal(payload.rpcUrl, 'http://127.0.0.1:8899');
    assert.ok(payload.walletAddress);
    assert.ok(payload.policyId);
    assert.ok(payload.balanceSol > 0, `expected local balance > 0, got ${payload.balanceSol}`);
    assert.match(payload.localHome, /\.surfpool\/aegis-local\/home$/);
    assert.match(payload.localDataDir, /\.surfpool\/aegis-local\/data$/);
  });

  it('executes the real CLI swap path against surfpool', () => {
    const child = runLocal(['swap', '--json', '--amount=0.001']);
    assert.equal(child.status, 0, child.stderr);
    const payload = parseLastJson(child.stdout);
    assert.equal(payload.executed, true);
    assert.equal(payload.swap.chain, 'solana');
    assert.equal(payload.swap.sender, 'Cb5zbGSXEfMKDkShgarxTN1KEzRXqQyZ2Xm7fobacJWG');
    assert.ok(Array.isArray(payload.swap.policiesPassed));
    assert.ok(payload.swap.policiesPassed.includes('spend-limit'));
    assert.ok(typeof payload.tx.hash === 'string' && payload.tx.hash.length > 0);
    assert.equal(payload.tx.status, 'success');
  });
});
