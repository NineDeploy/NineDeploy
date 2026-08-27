#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createClient } from '@ninedeploy/sdk';
import { TOOLS } from './tools.js';
export { TOOLS };

/**
 * NineDeploy MCP server (stdio transport).
 *
 * AI assistants use this to inspect and operate a NineDeploy instance.
 * Credentials come from the environment — never from the model:
 *   NINEDEPLOY_URL   base URL of the control plane (default http://127.0.0.1:3000)
 *   NINEDEPLOY_TOKEN an API token (create one in Settings → API tokens)
 *   NINEDEPLOY_MCP_READONLY=1 exposes only the non-mutating, non-secret allowlist
 */

export function buildServer(
  client: ReturnType<typeof createClient>,
  warn: (msg: string) => void = console.error,
  options: { readOnly?: boolean } = {},
): McpServer {
  const server = new McpServer({ name: 'ninedeploy', version: '0.3.3' });

  const tools = options.readOnly ? TOOLS.filter((tool) => READ_ONLY_TOOL_NAMES.has(tool.name)) : TOOLS;
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.input,
      },
      async (args) => {
        // The SDK already validated `args` against the same zod schema
        // (registered as inputSchema) before invoking this handler.
        try {
          const result = await tool.handler(client, args);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          return {
            isError: true,
            content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          };
        }
      },
    );
  }

  void warn; // stderr logger reserved for transport diagnostics
  return server;
}

export async function main(
  env: { NINEDEPLOY_URL?: string; NINEDEPLOY_TOKEN?: string; NINEDEPLOY_MCP_READONLY?: string } = process.env,
  io: {
    error: (msg: string) => void;
    exit: (code: number) => void;
    connect: (server: McpServer) => Promise<void>;
  } = DEFAULT_IO,
): Promise<void> {
  const url = env.NINEDEPLOY_URL ?? 'http://127.0.0.1:3000';
  const token = env.NINEDEPLOY_TOKEN;
  if (!token) {
    io.error('NINEDEPLOY_TOKEN is required (Settings → API tokens in the web UI).');
    io.exit(1);
  } else {
    const client = createClient({ baseUrl: url, getToken: staticToken(token) });
    const readOnly = /^(?:1|true|yes)$/i.test(env.NINEDEPLOY_MCP_READONLY ?? '');
    await io.connect(buildServer(client, console.error, { readOnly }));
  }
}

/** Explicit allowlist: newly added tools default to unavailable in read-only mode. */
export const READ_ONLY_TOOL_NAMES = new Set([
  'list_services', 'get_service', 'service_logs', 'list_deploys',
  'list_domains', 'list_databases', 'list_projects', 'list_alerts',
  'activity_log', 'system_stats', 'topology', 'health',
  'list_plugins', 'marketplace_plugins', 'list_menus',
  'list_workspaces', 'get_workspace', 'list_log_drains',
]);

/** A getToken closure that always returns the configured static token. */
export function staticToken(token: string): () => string {
  return () => token;
}

/** Production wiring: stderr diagnostics, real exit, stdio MCP transport. */
export const DEFAULT_IO = {
  error: (msg: string) => console.error(msg),
  exit: (code: number) => process.exit(code),
  // stdio is the standard MCP transport for local servers.
  connect: async (server: McpServer) => void (await server.connect(new StdioServerTransport())),
};

// Only run when executed directly (not under the test importer). Compares
// argv[1] against this module's own URL — matching by filename suffix alone
// would also fire for any other package's index.js entry.
export function isDirectRun(argv1: string | undefined, selfUrl: string): boolean {
  if (argv1 == null) return false;
  try {
    return pathToFileURL(argv1).href === selfUrl;
  } catch {
    /* v8 ignore next -- node:path accepts every string; defensive for exotic runtimes */
    return false;
  }
}

if (isDirectRun(process.argv[1], import.meta.url)) {
  void main();
}
