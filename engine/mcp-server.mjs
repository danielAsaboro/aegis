/**
 * AEGIS MCP Server — exposes the agent's tool catalog over the Model Context
 * Protocol so MCP-native clients (Codex CLI, Claude Code, Cursor, ...) can
 * drive AEGIS using their own subscription auth.
 *
 * Transport: STDIO. Wire it up in `~/.codex/config.toml`:
 *
 *   [mcp_servers.aegis]
 *   command = "node"
 *   args = ["/absolute/path/to/aegis/engine/index.mjs", "mcp"]
 *
 *   [mcp_servers.aegis.env]
 *   ZERION_API_KEY = "..."
 *   DEFAULT_WALLET = "main"
 *   DEFAULT_CHAIN = "solana"
 *
 * Tool surface mirrors `engine/agent/tools/index.mjs`. Every tool keeps its
 * existing approval / policy gate behavior — `executeSwap` still runs through
 * `runPolicies()` regardless of the MCP client's approval UI.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import env from './config.mjs';
import { allTools } from './agent/tools/index.mjs';

function buildContext() {
  return {
    experimental_context: {
      walletName: env.DEFAULT_WALLET || 'default',
      source: 'mcp',
      userId: 'mcp-client',
    },
  };
}

function extractShape(inputSchema) {
  if (!inputSchema) return {};
  if (typeof inputSchema === 'object' && inputSchema.shape) return inputSchema.shape;
  return {};
}

function formatToolResult(value) {
  let text;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return { content: [{ type: 'text', text }] };
}

function formatToolError(err) {
  const message = err?.message || String(err);
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

export async function startMcpServer() {
  const server = new McpServer({
    name: 'aegis',
    version: '1.0.0',
  });

  for (const [name, t] of Object.entries(allTools)) {
    const description = t.description || `AEGIS tool: ${name}`;
    const inputShape = extractShape(t.inputSchema);

    server.registerTool(
      name,
      {
        description,
        inputSchema: inputShape,
      },
      async (args) => {
        try {
          const result = await t.execute(args ?? {}, buildContext());
          return formatToolResult(result);
        } catch (err) {
          return formatToolError(err);
        }
      },
    );
  }

  const transport = new StdioServerTransport();

  const closed = new Promise((resolve, reject) => {
    transport.onerror = (err) => {
      process.stderr.write(`[mcp] transport error: ${err?.message || err}\n`);
      reject(err);
    };
    transport.onclose = () => {
      process.stderr.write('[mcp] transport closed\n');
      resolve();
    };
  });

  await server.connect(transport);
  process.stderr.write(`[mcp] server connected (${Object.keys(allTools).length} tools)\n`);

  // Hold the event loop until the host closes the transport. Without this,
  // the caller's `await startMcpServer()` would resolve as soon as listeners
  // are registered, and the parent process would exit immediately.
  await closed;
}
