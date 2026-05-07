/**
 * AEGIS Studio — local-only HTTP/WS observability surface.
 *
 * Bound to 127.0.0.1 only. Browser clients pass ?token=<one-time> on every
 * REST + WS request; mismatch → 401. The token is generated at boot and
 * printed to stderr — same trust model as `prisma studio`.
 */

import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import staticPlugin from '@fastify/static';

import logger, { createLogger } from '../core/logger.mjs';
import { registerOverviewRoutes } from './routes/overview.mjs';
import { registerAgentRoutes } from './routes/agent.mjs';
import { registerStrategyRoutes } from './routes/strategies.mjs';
import { registerTradeRoutes } from './routes/trades.mjs';
import { registerSignalSocket } from './ws/signals.mjs';
import { registerLogSocket, attachLogStream } from './ws/logs.mjs';

const studioLog = createLogger('studio');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WEB_DIST = join(__dirname, 'web', 'dist');
const WEB_SRC = join(__dirname, 'web');

/**
 * Boot the studio server alongside the engine.
 * @param {object} opts
 * @param {number} opts.port - port to bind on 127.0.0.1
 * @returns {Promise<{ stop: () => Promise<void>, url: string, token: string }>}
 */
export async function startStudio({ port = 7474 } = {}) {
  const token = randomBytes(18).toString('base64url');
  process.env.STUDIO_TOKEN = token;
  process.env.STUDIO_ENABLED = '1';

  // Tee pino → log-WS subscribers. Must happen before clients connect
  // so the in-memory ring buffer captures bootstrap lines.
  attachLogStream(logger);

  const app = Fastify({ logger: false, trustProxy: false });

  await app.register(websocket);

  // Token gate — every /api and /ws request must carry ?token=. Static
  // index.html is served openly so the browser can read it and pull the
  // token from the URL fragment for follow-up calls.
  app.addHook('onRequest', async (req, reply) => {
    const url = req.raw.url || '';
    if (!url.startsWith('/api/') && !url.startsWith('/ws/')) return;
    const supplied = req.query?.token || req.headers['x-studio-token'];
    if (supplied !== token) {
      reply.code(401).send({ error: 'invalid_token' });
    }
  });

  await registerOverviewRoutes(app);
  await registerAgentRoutes(app);
  await registerStrategyRoutes(app);
  await registerTradeRoutes(app);
  registerSignalSocket(app);
  registerLogSocket(app);

  const distExists = existsSync(join(WEB_DIST, 'index.html'));
  if (distExists) {
    await app.register(staticPlugin, {
      root: WEB_DIST,
      prefix: '/',
      decorateReply: false,
    });
  } else {
    // Dev fallback — frontend not built yet. Serve a tiny notice so the
    // operator knows what's missing rather than a blank 404.
    app.get('/', async (_req, reply) => {
      reply.type('text/html').send(devNoticeHtml(port, token));
    });
    studioLog.warn(
      { dist: WEB_DIST, src: WEB_SRC },
      'Studio web/dist not found — run `pnpm --filter ./engine/studio/web build` to ship the UI',
    );
  }

  // SPA fallback — anything that isn't an API/WS/asset goes to index.html.
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith('/api/') || req.raw.url?.startsWith('/ws/')) {
      reply.code(404).send({ error: 'not_found' });
      return;
    }
    if (distExists) {
      reply.sendFile('index.html');
    } else {
      reply.type('text/html').send(devNoticeHtml(port, token));
    }
  });

  try {
    await app.listen({ host: '127.0.0.1', port });
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      studioLog.fatal(
        { port },
        `Studio port ${port} is already bound. Pass --studio-port <n> or free the port.`,
      );
    } else {
      studioLog.fatal({ err: err.message }, 'Studio server failed to start');
    }
    throw err;
  }

  const url = `http://127.0.0.1:${port}/?token=${token}`;
  process.stderr.write(`\n▶ AEGIS Studio: ${url}\n\n`);
  studioLog.info({ port, url }, 'Studio listening');

  return {
    url,
    token,
    port,
    stop: async () => {
      await app.close();
      studioLog.info('Studio stopped');
    },
  };
}

function devNoticeHtml(port, token) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>AEGIS Studio</title>
<style>
  body{background:#FBF7EE;color:#1F1D1B;font-family:ui-sans-serif,system-ui;padding:48px;max-width:720px;margin:0 auto;line-height:1.6}
  code{background:#F0EADB;padding:2px 6px;border-radius:4px}
  h1{font-weight:500;letter-spacing:-0.02em}
</style></head><body>
<h1>AEGIS Studio — UI not built yet</h1>
<p>The server is up on <code>127.0.0.1:${port}</code> but the React bundle hasn't been built.</p>
<p>From <code>aegis/engine/studio/web/</code>: <code>pnpm install && pnpm build</code></p>
<p>API is reachable now: <code>/api/overview?token=${token}</code></p>
</body></html>`;
}
