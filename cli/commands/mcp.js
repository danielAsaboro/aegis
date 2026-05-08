/**
 * aegis mcp — launch the AEGIS MCP STDIO server.
 *
 * Designed to be spawned by an MCP host (Codex CLI, Claude Code, Cursor).
 * Reads stdin / writes stdout for the MCP protocol; logs go to stderr so
 * they don't corrupt the JSON-RPC stream.
 *
 * Invocation:
 *   node engine/index.mjs mcp
 */

export default async function mcpCmd() {
  // Route pino logs to stderr — stdout carries the JSON-RPC stream.
  // Must be set BEFORE the logger module is loaded.
  process.env.AEGIS_LOG_STDERR = '1';

  const { startMcpServer } = await import('../engine/mcp-server.mjs');
  try {
    await startMcpServer();
  } catch (err) {
    process.stderr.write(`AEGIS MCP server failed: ${err?.message || err}\n`);
    process.exit(1);
  }
}
