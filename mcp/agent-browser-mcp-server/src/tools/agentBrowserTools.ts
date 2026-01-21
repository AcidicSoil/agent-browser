import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { runAgentBrowser } from '../services/agentBrowserCli.js';
import { CliGlobalOptions } from '../types.js';
import { ALLOWED_ROOT_COMMANDS, ERR_NOT_ALLOWED } from '../constants.js';

const GlobalOptionsShape = z.object({
  session: z.string().optional(),
  cdp_port: z.number().optional(),
  headed: z.boolean().optional(),
  debug: z.boolean().optional(),
  executable_path: z.string().optional(),
  json: z.boolean().optional(),
  timeout_ms: z.number().optional(),
  save_output_path: z.string().optional(),
});

function mapGlobalOptions(input: z.infer<typeof GlobalOptionsShape>): CliGlobalOptions {
  return {
    session: input.session,
    cdpPort: input.cdp_port,
    headed: input.headed,
    debug: input.debug,
    executablePath: input.executable_path,
    json: input.json,
    timeoutMs: input.timeout_ms,
  };
}

// Helper to execute and format response
async function executeAgentBrowserCommand(
  argv: string[],
  globalInput: z.infer<typeof GlobalOptionsShape>,
  saveOutputPath?: string
) {
  const options = mapGlobalOptions(globalInput);
  // If save_output_path is passed in globalInput, use it, otherwise use the specific arg
  const finalSavePath = saveOutputPath || globalInput.save_output_path;
  
  const result = await runAgentBrowser({
    argv,
    options,
    saveOutputPath: finalSavePath
  });

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(result, null, 2)
      }
    ]
  };
}

export function registerAgentBrowserTools(server: McpServer) {
  // agent_browser_open
  server.tool(
    'agent_browser_open',
    'Open a URL in the browser',
    {
      url: z.string(),
      headers: z.record(z.string()).optional(),
      ...GlobalOptionsShape.shape,
    },
    async ({ url, headers, ...globals }) => {
      const argv = ['open', url];
      if (headers) {
        argv.push('--headers', JSON.stringify(headers));
      }
      return executeAgentBrowserCommand(argv, globals);
    }
  );

  // agent_browser_snapshot
  server.tool(
    'agent_browser_snapshot',
    'Take a snapshot of the current page state',
    {
      selector: z.string().optional(),
      interactive: z.boolean().default(true),
      compact: z.boolean().default(true),
      depth: z.number().default(5),
      ...GlobalOptionsShape.shape,
    },
    async ({ selector, interactive, compact, depth, ...globals }) => {
      const argv = ['snapshot'];
      if (selector) argv.push(selector);
      if (interactive) argv.push('--interactive');
      if (compact) argv.push('--compact');
      argv.push('--depth', depth.toString());
      
      return executeAgentBrowserCommand(argv, globals);
    }
  );

  // agent_browser_click
  server.tool(
    'agent_browser_click',
    'Click an element identified by a ref or selector',
    {
      ref: z.string(),
      ...GlobalOptionsShape.shape,
    },
    async ({ ref, ...globals }) => {
      return executeAgentBrowserCommand(['click', ref], globals);
    }
  );

  // agent_browser_fill
  server.tool(
    'agent_browser_fill',
    'Fill an input element with a value',
    {
      ref: z.string(),
      value: z.string(),
      ...GlobalOptionsShape.shape,
    },
    async ({ ref, value, ...globals }) => {
      return executeAgentBrowserCommand(['fill', ref, value], globals);
    }
  );

  // agent_browser_type
  server.tool(
    'agent_browser_type',
    'Type text into an element',
    {
      ref: z.string(),
      value: z.string(),
      ...GlobalOptionsShape.shape,
    },
    async ({ ref, value, ...globals }) => {
      return executeAgentBrowserCommand(['type', ref, value], globals);
    }
  );

  // agent_browser_press
  server.tool(
    'agent_browser_press',
    'Press a key or combination of keys',
    {
      key: z.string(),
      ...GlobalOptionsShape.shape,
    },
    async ({ key, ...globals }) => {
      return executeAgentBrowserCommand(['press', key], globals);
    }
  );

  // Navigation Tools
  server.tool(
    'agent_browser_back',
    'Navigate back in history',
    { ...GlobalOptionsShape.shape },
    async (globals) => executeAgentBrowserCommand(['back'], globals)
  );

  server.tool(
    'agent_browser_forward',
    'Navigate forward in history',
    { ...GlobalOptionsShape.shape },
    async (globals) => executeAgentBrowserCommand(['forward'], globals)
  );

  server.tool(
    'agent_browser_reload',
    'Reload the current page',
    { ...GlobalOptionsShape.shape },
    async (globals) => executeAgentBrowserCommand(['reload'], globals)
  );

  server.tool(
    'agent_browser_close',
    'Close the browser or page',
    { ...GlobalOptionsShape.shape },
    async (globals) => executeAgentBrowserCommand(['close'], globals)
  );

  // Session Tools
  server.tool(
    'agent_browser_session',
    'Get the current session ID',
    { ...GlobalOptionsShape.shape },
    async (globals) => executeAgentBrowserCommand(['session'], globals)
  );

  server.tool(
    'agent_browser_session_list',
    'List active sessions',
    { ...GlobalOptionsShape.shape },
    async (globals) => executeAgentBrowserCommand(['session-list'], globals)
  );

  // CDP Connect
  server.tool(
    'agent_browser_connect',
    'Connect to an existing CDP port',
    {
      port: z.number(),
      ...GlobalOptionsShape.shape,
    },
    async ({ port, ...globals }) => {
      return executeAgentBrowserCommand(['connect', port.toString()], globals);
    }
  );

  // Set Headers
  server.tool(
    'agent_browser_set_headers',
    'Set custom HTTP headers',
    {
      headers: z.record(z.string()),
      ...GlobalOptionsShape.shape,
    },
    async ({ headers, ...globals }) => {
      return executeAgentBrowserCommand(['set-headers', JSON.stringify(headers)], globals);
    }
  );

  // Passthrough Tool
  server.tool(
    'agent_browser_command',
    'Run a raw agent-browser command (restricted)',
    {
      argv: z.array(z.string()).min(1),
      ...GlobalOptionsShape.shape,
    },
    async ({ argv, save_output_path, ...globals }) => {
      const command = argv[0];
      if (!ALLOWED_ROOT_COMMANDS.has(command)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                ok: false,
                exitCode: -1,
                stderr: `${ERR_NOT_ALLOWED}: ${command}`,
                isError: true
              }, null, 2)
            }
          ],
          isError: true
        };
      }
      return executeAgentBrowserCommand(argv, globals, save_output_path);
    }
  );
}