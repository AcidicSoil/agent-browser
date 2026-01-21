#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SERVER_NAME, SERVER_VERSION } from './constants.js';
import { registerAgentBrowserTools } from './tools/agentBrowserTools.js';

// Redirect console.log to console.error to avoid interfering with JSON-RPC over stdout
console.log = console.error;

async function main() {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerAgentBrowserTools(server);

  const transport = new StdioServerTransport();
  
  await server.connect(transport);
  
  // Keep process alive
  // StdioServerTransport keeps the process alive by listening on stdin
}

main().catch((error) => {
  console.error('Fatal error in MCP server:', error);
  process.exit(1);
});