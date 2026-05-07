/**
 * Minimal logger for the ai-sdk-qvac package.
 *
 * Replaces the AEGIS pino-based logger in the vendored copy. All output
 * goes to stderr (so stdout stays clean for downstream consumers, e.g.
 * MCP STDIO hosts). Set DEBUG_AI_SDK_QVAC=1 to see info+debug; warn and
 * error always print.
 */

const VERBOSE = process.env.DEBUG_AI_SDK_QVAC === '1' || process.env.DEBUG === 'ai-sdk-qvac';

function fmt(level, label, payload, msg) {
  const stamp = new Date().toISOString();
  const head = `[ai-sdk-qvac:${label}] ${stamp} ${level}`;
  if (msg && payload && Object.keys(payload).length > 0) {
    return `${head} ${msg} ${JSON.stringify(payload)}`;
  }
  if (msg) return `${head} ${msg}`;
  if (payload) return `${head} ${JSON.stringify(payload)}`;
  return head;
}

export function createLogger(label) {
  const write = (level, payload, msg) => {
    process.stderr.write(fmt(level, label, payload, msg) + '\n');
  };
  return {
    debug: (payload, msg) => { if (VERBOSE) write('debug', payload, msg); },
    info: (payload, msg) => { if (VERBOSE) write('info', payload, msg); },
    warn: (payload, msg) => write('warn', payload, msg),
    error: (payload, msg) => write('error', payload, msg),
  };
}
