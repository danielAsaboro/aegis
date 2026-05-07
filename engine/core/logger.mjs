/**
 * AEGIS structured logger — pino-based.
 * Child loggers for each subsystem (monitor, strategy, policy, execution, bot).
 *
 * When STUDIO_ENABLED=1, pino is wired with `multistream` so every log
 * line is teed to (a) the normal terminal destination AND (b) the
 * in-process log bridge that the studio's /ws/logs reads from. The
 * studio module sets STUDIO_ENABLED before this module is imported (see
 * engine/index.mjs).
 */

import pino from 'pino';
import { logBridge } from './log-bridge.mjs';

const level = process.env.LOG_LEVEL || 'info';
const studioEnabled = process.env.STUDIO_ENABLED === '1';

// When running as an MCP STDIO server, stdout carries the JSON-RPC stream —
// any log byte there breaks the protocol. AEGIS_LOG_STDERR=1 routes logs
// through fd 2 (stderr) instead.
const useStderr = process.env.AEGIS_LOG_STDERR === '1';

function buildLogger() {
  const baseOpts = {
    level,
    base: { service: 'aegis' },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (studioEnabled) {
    // multistream forks every log line — terminal AND studio bridge.
    // Transport workers are bypassed here because multistream wants
    // synchronous Writables; that's fine, we only lose the pretty
    // transport (none was configured by default anyway).
    const terminal = pino.destination(useStderr ? 2 : 1);
    return pino(
      baseOpts,
      pino.multistream([
        { stream: terminal },
        { stream: logBridge },
      ]),
    );
  }

  return pino(
    {
      ...baseOpts,
      transport: process.stdout.isTTY && !useStderr
        ? { target: 'pino/file', options: { destination: 1 } }
        : undefined,
    },
    useStderr ? pino.destination(2) : undefined,
  );
}

const logger = buildLogger();

export default logger;

export const monitorLog = logger.child({ component: 'monitor' });
export const strategyLog = logger.child({ component: 'strategy' });
export const policyLog = logger.child({ component: 'policy' });
export const executionLog = logger.child({ component: 'execution' });
export const botLog = logger.child({ component: 'bot' });
export const storeLog = logger.child({ component: 'store' });
export const magicblockLog = logger.child({ component: 'magicblock' });

/** Create a named child logger. */
export function createLogger(name) {
  return logger.child({ component: name });
}
