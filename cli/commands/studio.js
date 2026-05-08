/**
 * zerion studio — open AEGIS Studio.
 *
 * Two modes:
 *   1. If a studio is already running on the target port, open the
 *      browser at the existing URL (we can't recover its token from
 *      outside the engine process, so the user is responsible for
 *      pasting the token from the original terminal).
 *   2. Otherwise spawn `aegis --studio` in the foreground — same as
 *      typing it directly, but discoverable through the zerion CLI.
 *
 * Flags:
 *   --port <n>    bind port (default 7474)
 *   --no-open     don't try to open the browser automatically
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import net from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KRAKEN_ROOT = join(__dirname, '..');
const AEGIS_BIN = join(KRAKEN_ROOT, 'engine', 'index.mjs');

export default async function studioCmd(args, flags) {
  const port = Number(flags.port || flags['studio-port'] || 7474);
  const noOpen = !!flags['no-open'];

  const inUse = await portInUse(port);
  if (inUse) {
    const url = `http://127.0.0.1:${port}/`;
    process.stderr.write(`AEGIS Studio appears to already be running on ${url}\n`);
    process.stderr.write('  (paste the token from the terminal that booted it)\n');
    if (!noOpen) await openBrowser(url);
    return;
  }

  if (!existsSync(AEGIS_BIN)) {
    process.stderr.write(`aegis entry not found at ${AEGIS_BIN}\n`);
    process.exit(1);
  }

  const child = spawn(process.execPath, [AEGIS_BIN, '--studio', '--studio-port', String(port)], {
    stdio: 'inherit',
    env: process.env,
  });

  if (!noOpen) {
    // Give the server a moment to bind, then open the browser. The
    // engine prints `▶ AEGIS Studio: http://127.0.0.1:<port>?token=…`
    // — we can't read the token from here, so we open the bare URL
    // and rely on the operator to grab the token line from stderr.
    setTimeout(() => {
      openBrowser(`http://127.0.0.1:${port}/`).catch(() => {});
    }, 1500);
  }

  child.on('exit', (code) => process.exit(code ?? 0));
}

function portInUse(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', (err) => {
      if (err.code === 'EADDRINUSE') resolve(true);
      else resolve(false);
    });
    s.once('listening', () => {
      s.close(() => resolve(false));
    });
    s.listen(port, '127.0.0.1');
  });
}

async function openBrowser(url) {
  const cmd =
    process.platform === 'darwin' ? 'open' :
    process.platform === 'win32' ? 'start' :
    'xdg-open';
  try {
    spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* user can copy/paste */
  }
}
