/**
 * Studio routes — verifies the fastify app boots, gates by token, and
 * returns the expected JSON shape from /api/overview.
 *
 * Tests use a temp SQLite DB and `app.inject()` so we never bind a
 * real port and don't depend on a running engine.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

process.env.TELEGRAM_BOT_TOKEN ??= 'test_token';
process.env.ZERION_API_KEY ??= 'test_key';
process.env.STUDIO_ENABLED = '1';
process.env.STUDIO_TOKEN = 'unit-test-token';

const TMP = mkdtempSync(join(tmpdir(), 'aegis-studio-test-'));
process.env.DATA_DIR = TMP;
process.env.AEGIS_DATABASE_URL = `file:${join(TMP, 'studio.db')}`;

const { initDb, pushDbSchema } = await import('../../../engine/db/index.mjs');
const Fastify = (await import('fastify')).default;
const websocket = (await import('@fastify/websocket')).default;
const { registerOverviewRoutes } = await import('../../../engine/studio/routes/overview.mjs');
const { registerAgentRoutes } = await import('../../../engine/studio/routes/agent.mjs');
const { registerStrategyRoutes } = await import('../../../engine/studio/routes/strategies.mjs');
const { registerTradeRoutes } = await import('../../../engine/studio/routes/trades.mjs');

let app;

before(async () => {
  try { pushDbSchema(); } catch { /* already pushed */ }
  await initDb();
  app = Fastify({ logger: false });
  await app.register(websocket);
  app.addHook('onRequest', async (req, reply) => {
    const url = req.raw.url || '';
    if (!url.startsWith('/api/')) return;
    const supplied = req.query?.token;
    if (supplied !== 'unit-test-token') {
      reply.code(401).send({ error: 'invalid_token' });
    }
  });
  await registerOverviewRoutes(app);
  await registerAgentRoutes(app);
  await registerStrategyRoutes(app);
  await registerTradeRoutes(app);
});

after(async () => {
  if (app) await app.close();
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('studio routes', () => {
  test('GET /api/overview without token → 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/overview' });
    assert.equal(r.statusCode, 401);
  });

  test('GET /api/overview with token → 200 + expected shape', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/overview?token=unit-test-token' });
    assert.equal(r.statusCode, 200);
    const body = r.json();
    assert.ok(body.engine);
    assert.equal(typeof body.engine.uptimeMs, 'number');
    assert.ok(Array.isArray(body.strategies));
    assert.ok(body.signals && typeof body.signals === 'object');
    assert.ok(body.counts);
    assert.equal(typeof body.counts.activeDcaPlans, 'number');
  });

  test('GET /api/agent/invocations returns paginated rows envelope', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/agent/invocations?token=unit-test-token' });
    assert.equal(r.statusCode, 200);
    const body = r.json();
    assert.ok(Array.isArray(body.rows));
    assert.ok('nextCursor' in body);
  });

  test('GET /api/strategies/dca returns array', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/strategies/dca?token=unit-test-token' });
    assert.equal(r.statusCode, 200);
    assert.ok(Array.isArray(r.json()));
  });

  test('GET /api/trades returns rows + totals', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/trades?token=unit-test-token' });
    assert.equal(r.statusCode, 200);
    const body = r.json();
    assert.ok(Array.isArray(body.rows));
    assert.ok(body.totals);
  });
});
