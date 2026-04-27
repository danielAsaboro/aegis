/**
 * AEGIS structured logger — pino-based.
 * Child loggers for each subsystem (monitor, strategy, policy, execution, bot).
 */

import pino from 'pino';

const level = process.env.LOG_LEVEL || 'info';

const logger = pino({
  level,
  transport: process.stdout.isTTY
    ? { target: 'pino/file', options: { destination: 1 } }
    : undefined,
  base: { service: 'kraken' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

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
