<filetree>
Project Structure:
└── mcp
    ├── agent-browser-mcp-server
    │   ├── src
    │   │   ├── services
    │   │   │   └── agentBrowserCli.ts
    │   │   ├── tools
    │   │   │   └── agentBrowserTools.ts
    │   │   ├── constants.ts
    │   │   ├── index.ts
    │   │   └── types.ts
    │   ├── inspector.config.json
    │   ├── package.json
    │   └── tsconfig.json
    └── scaffold_mcp.md

</filetree>

<source_code>
mcp/scaffold_mcp.md
```
This MCP server wraps the installed `agent-browser` CLI (from either repo) and exposes a small set of high-signal tools plus an “advanced” passthrough for any supported subcommand. It follows the recommended `registerTool()` + Zod schema pattern.

`agent-browser` itself is designed for “open → snapshot (-i) → interact via @refs → re-snapshot” workflows.

```text
agent-browser-mcp-server/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts
    ├── constants.ts
    ├── types.ts
    ├── services/
    │   └── agentBrowserCli.ts
    └── tools/
        └── agentBrowserTools.ts
```

```jsonc
// path: agent-browser-mcp-server/package.json
{
  "name": "agent-browser-mcp-server",
  "version": "0.1.0",
  "description": "MCP server wrapper for agent-browser CLI (open/snapshot/click/fill/etc).",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "agent-browser-mcp-server": "dist/index.js"
  },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "clean": "rm -rf dist"
  },
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.6.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2"
  }
}
```

```jsonc
// path: agent-browser-mcp-server/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "allowSyntheticDefaultImports": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

````md
<!-- path: agent-browser-mcp-server/README.md -->

# agent-browser-mcp-server

MCP (stdio) server that shells out to `agent-browser` and returns parsed `--json` output when available.

## Prereqs

1) Install `agent-browser` and its Chromium dependency.
- `agent-browser install` downloads Chromium; `agent-browser install --with-deps` also installs Linux system deps. :contentReference[oaicite:2]{index=2}

2) Ensure the `agent-browser` binary is on PATH, or set `AGENT_BROWSER_BIN`.

## Install + run

```bash
cd agent-browser-mcp-server
npm i
npm run build
npm start
````

## MCP client config (example)

Use your MCP client’s stdio config, pointing to `dist/index.js`. Example shape:

```jsonc
{
  "mcpServers": {
    "agent-browser": {
      "command": "node",
      "args": ["/absolute/path/to/agent-browser-mcp-server/dist/index.js"],
      "env": {
        "AGENT_BROWSER_BIN": "agent-browser",
        "AGENT_BROWSER_SESSION": "default"
      }
    }
  }
}
```

## Environment variables

* `AGENT_BROWSER_BIN`: path/command for the CLI (default: `agent-browser`)
* `AGENT_BROWSER_SESSION`: default session if not provided per-call (agent-browser supports isolated sessions).

## Tooling notes

* Recommended workflow: `agent_browser_open` → `agent_browser_snapshot` (interactive refs) → `agent_browser_click/fill/type` using `@eN` refs.
* CDP mode is supported via `agent_browser_connect` or per-call `cdp_port` (agent-browser CLI supports `connect <port>` and `--cdp <port>`).
* Headers can be set origin-scoped via `--headers` with `open`, or globally via `set headers`.

````

```ts
// path: agent-browser-mcp-server/src/constants.ts
export const SERVER_NAME = "agent-browser-mcp-server";
export const SERVER_VERSION = "0.1.0";

/**
 * Keep outputs reasonably bounded for MCP clients.
 * If you want larger snapshots, use snapshot filters (interactive/compact/depth/selector). :contentReference[oaicite:7]{index=7}
 */
export const CHARACTER_LIMIT = 25000;

export const DEFAULT_TIMEOUT_MS = 60_000;

export const DEFAULT_BIN = "agent-browser";

/**
 * For the "advanced" passthrough tool, require argv[0] to be a known top-level command token.
 * This is not a security boundary (no shell is used), but it helps keep calls intentional.
 */
export const ALLOWED_ROOT_COMMANDS = new Set([
  "open",
  "back",
  "forward",
  "reload",
  "close",
  "snapshot",
  "click",
  "dblclick",
  "focus",
  "fill",
  "type",
  "press",
  "keydown",
  "keyup",
  "hover",
  "check",
  "uncheck",
  "upload",
  "get",
  "find",
  "set",
  "connect",
  "tab",
  "session"
]);
````

```ts
// path: agent-browser-mcp-server/src/types.ts
export type CliGlobalOptions = {
  session?: string;
  cdpPort?: number;
  headed?: boolean;
  debug?: boolean;
  executablePath?: string;
  /**
   * If true (default), pass --json to agent-browser for machine parsing. :contentReference[oaicite:8]{index=8}
   */
  json?: boolean;
  timeoutMs?: number;
};

export type CliRunRequest = {
  argv: string[]; // subcommand + args + any command-specific flags (no shell)
  global?: CliGlobalOptions;
  /**
   * If set, the MCP server writes stdout to this file (relative path only).
   * This is useful for large snapshots without stuffing the MCP response.
   */
  saveOutputPath?: string;
};

export type CliRunResult = {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  invoked: {
    bin: string;
    args: string[];
  };
  stdout: string;
  stderr: string;
  parsedJson: unknown | null;
  truncated: boolean;
  savedOutputPath?: string;
};
```

```ts
// path: agent-browser-mcp-server/src/services/agentBrowserCli.ts
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { CHARACTER_LIMIT, DEFAULT_BIN, DEFAULT_TIMEOUT_MS } from "../constants.js";
import type { CliRunRequest, CliRunResult, CliGlobalOptions } from "../types.js";

function getBin(): string {
  return process.env.AGENT_BROWSER_BIN?.trim() || DEFAULT_BIN;
}

function sanitizeArg(arg: string): string {
  if (arg.includes("\u0000")) throw new Error("Invalid argument: contains NUL byte");
  if (arg.length > 16_384) throw new Error("Invalid argument: too long");
  return arg;
}

/**
 * Only allow relative paths without traversal. This is basic hygiene; adjust to your needs.
 */
function validateRelativePath(p: string): string {
  if (!p) throw new Error("saveOutputPath is empty");
  if (path.isAbsolute(p)) throw new Error("saveOutputPath must be relative (not absolute)");
  const norm = path.normalize(p);
  if (norm.startsWith("..") || norm.includes(`..${path.sep}`)) {
    throw new Error("saveOutputPath must not contain '..' path traversal");
  }
  return norm;
}

function buildGlobalArgs(global?: CliGlobalOptions): string[] {
  const g = global ?? {};
  const args: string[] = [];

  const session = g.session ?? process.env.AGENT_BROWSER_SESSION?.trim();
  if (session) {
    args.push("--session", sanitizeArg(session));
  }
  if (typeof g.cdpPort === "number") {
    args.push("--cdp", String(g.cdpPort));
  }
  if (g.headed) {
    args.push("--headed");
  }
  if (g.debug) {
    args.push("--debug");
  }
  if (g.executablePath) {
    args.push("--executable-path", sanitizeArg(g.executablePath));
  }

  // Default to JSON output unless explicitly disabled.
  if (g.json !== false) {
    args.push("--json");
  }

  return args;
}

function truncateIfNeeded(s: string): { text: string; truncated: boolean } {
  if (s.length <= CHARACTER_LIMIT) return { text: s, truncated: false };
  return { text: s.slice(0, CHARACTER_LIMIT) + "\n...<truncated>...", truncated: true };
}

function tryParseJson(stdout: string): unknown | null {
  const t = stdout.trim();
  if (!t) return null;
  if (!(t.startsWith("{") || t.startsWith("["))) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

export async function runAgentBrowser(req: CliRunRequest): Promise<CliRunResult> {
  const bin = getBin();

  const globalArgs = buildGlobalArgs(req.global);
  const cmdArgs = (req.argv || []).map(sanitizeArg);
  const args = [...globalArgs, ...cmdArgs];

  const timeoutMs = req.global?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let stdoutBuf = "";
  let stderrBuf = "";

  const child = spawn(bin, args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false
  });

  const killTimer = setTimeout(() => {
    child.kill("SIGKILL");
  }, timeoutMs);

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", (d) => {
    stdoutBuf += d;
  });
  child.stderr.on("data", (d) => {
    stderrBuf += d;
  });

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal }));
  }).finally(() => clearTimeout(killTimer));

  const parsed = tryParseJson(stdoutBuf);

  // Avoid truncating JSON that needs to be parsed; return full if parsedJson is present.
  const stdoutOut = parsed ? stdoutBuf : truncateIfNeeded(stdoutBuf);
  const stderrOut = truncateIfNeeded(stderrBuf);

  let savedOutputPath: string | undefined;
  if (req.saveOutputPath) {
    const rel = validateRelativePath(req.saveOutputPath);
    await fs.mkdir(path.dirname(rel), { recursive: true });
    await fs.writeFile(rel, stdoutBuf, "utf8");
    savedOutputPath = rel;
  }

  const ok = exit.code === 0;

  return {
    ok,
    exitCode: exit.code,
    signal: exit.signal,
    invoked: { bin, args },
    stdout: typeof stdoutOut === "string" ? stdoutOut : stdoutOut.text,
    stderr: stderrOut.text,
    parsedJson: parsed,
    truncated: (typeof stdoutOut === "string" ? false : stdoutOut.truncated) || stderrOut.truncated,
    savedOutputPath
  };
}
```

```ts
// path: agent-browser-mcp-server/src/tools/agentBrowserTools.ts
import { z } from "zod";
import { ALLOWED_ROOT_COMMANDS } from "../constants.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runAgentBrowser } from "../services/agentBrowserCli.js";

const GlobalOptionsShape = {
  session: z.string().min(1).optional(),
  cdp_port: z.number().int().positive().optional(),
  headed: z.boolean().optional(),
  debug: z.boolean().optional(),
  executable_path: z.string().min(1).optional(),
  json: z.boolean().optional(),
  timeout_ms: z.number().int().positive().optional()
};

function mapGlobalOptions(input: any) {
  return {
    session: input.session,
    cdpPort: input.cdp_port,
    headed: input.headed,
    debug: input.debug,
    executablePath: input.executable_path,
    json: input.json,
    timeoutMs: input.timeout_ms
  };
}

const OutputShape = {
  ok: z.boolean(),
  exitCode: z.number().nullable(),
  signal: z.string().nullable(),
  invoked: z.object({
    bin: z.string(),
    args: z.array(z.string())
  }),
  stdout: z.string(),
  stderr: z.string(),
  parsedJson: z.unknown().nullable(),
  truncated: z.boolean(),
  savedOutputPath: z.string().optional()
};

export function registerAgentBrowserTools(server: McpServer) {
  // open <url>
  server.registerTool(
    "agent_browser_open",
    {
      title: "agent-browser: open",
      description:
        "Navigate to a URL using agent-browser. Recommended workflow is open → snapshot (-i) → interact via @refs. ",
      inputSchema: {
        url: z.string().min(1),
        headers: z.record(z.string()).optional(),
        save_output_path: z.string().optional(),
        ...GlobalOptionsShape
      },
      outputSchema: OutputShape,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: true
      }
    },
    async (input) => {
      const argv = ["open", input.url];

      // Origin-scoped headers can be set on open via --headers.
      if (input.headers) {
        argv.push("--headers", JSON.stringify(input.headers));
      }

      const result = await runAgentBrowser({
        argv,
        global: mapGlobalOptions(input),
        saveOutputPath: input.save_output_path
      });

      return {
        isError: !result.ok,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );

  // snapshot [-i] [-c] [-d n] [-s selector]
  server.registerTool(
    "agent_browser_snapshot",
    {
      title: "agent-browser: snapshot",
      description:
        "Get a page snapshot. Use interactive refs (-i) for deterministic follow-up actions; compact/depth/selector reduce output size. :contentReference[oaicite:11]{index=11}",
      inputSchema: {
        interactive: z.boolean().optional().default(true),
        compact: z.boolean().optional().default(true),
        depth: z.number().int().positive().optional().default(5),
        selector: z.string().min(1).optional(),
        save_output_path: z.string().optional(),
        ...GlobalOptionsShape
      },
      outputSchema: OutputShape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: true
      }
    },
    async (input) => {
      const argv: string[] = ["snapshot"];
      if (input.interactive) argv.push("-i");
      if (input.compact) argv.push("-c");
      if (typeof input.depth === "number") argv.push("-d", String(input.depth));
      if (input.selector) argv.push("-s", input.selector);

      const result = await runAgentBrowser({
        argv,
        global: mapGlobalOptions(input),
        saveOutputPath: input.save_output_path
      });

      return {
        isError: !result.ok,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );

  // click <selector|@ref>
  server.registerTool(
    "agent_browser_click",
    {
      title: "agent-browser: click",
      description: "Click an element. Prefer @refs from snapshot -i for determinism. :contentReference[oaicite:12]{index=12}",
      inputSchema: {
        target: z.string().min(1),
        save_output_path: z.string().optional(),
        ...GlobalOptionsShape
      },
      outputSchema: OutputShape,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: true
      }
    },
    async (input) => {
      const result = await runAgentBrowser({
        argv: ["click", input.target],
        global: mapGlobalOptions(input),
        saveOutputPath: input.save_output_path
      });

      return {
        isError: !result.ok,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );

  // fill <selector|@ref> <value>
  server.registerTool(
    "agent_browser_fill",
    {
      title: "agent-browser: fill",
      description: "Clear and type into an input. Prefer @refs from snapshot -i. ",
      inputSchema: {
        target: z.string().min(1),
        value: z.string(),
        save_output_path: z.string().optional(),
        ...GlobalOptionsShape
      },
      outputSchema: OutputShape,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: true
      }
    },
    async (input) => {
      const result = await runAgentBrowser({
        argv: ["fill", input.target, input.value],
        global: mapGlobalOptions(input),
        saveOutputPath: input.save_output_path
      });

      return {
        isError: !result.ok,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );

  // type <selector|@ref> <text>
  server.registerTool(
    "agent_browser_type",
    {
      title: "agent-browser: type",
      description: "Type into an input without clearing. Prefer @refs from snapshot -i. ",
      inputSchema: {
        target: z.string().min(1),
        text: z.string(),
        save_output_path: z.string().optional(),
        ...GlobalOptionsShape
      },
      outputSchema: OutputShape,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: true
      }
    },
    async (input) => {
      const result = await runAgentBrowser({
        argv: ["type", input.target, input.text],
        global: mapGlobalOptions(input),
        saveOutputPath: input.save_output_path
      });

      return {
        isError: !result.ok,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );

  // press <key>
  server.registerTool(
    "agent_browser_press",
    {
      title: "agent-browser: press",
      description: "Press a key (e.g., Enter, Control+a). :contentReference[oaicite:15]{index=15}",
      inputSchema: {
        key: z.string().min(1),
        save_output_path: z.string().optional(),
        ...GlobalOptionsShape
      },
      outputSchema: OutputShape,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: true
      }
    },
    async (input) => {
      const result = await runAgentBrowser({
        argv: ["press", input.key],
        global: mapGlobalOptions(input),
        saveOutputPath: input.save_output_path
      });

      return {
        isError: !result.ok,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );

  // navigation: back/forward/reload/close
  for (const cmd of ["back", "forward", "reload", "close"] as const) {
    server.registerTool(
      `agent_browser_${cmd}`,
      {
        title: `agent-browser: ${cmd}`,
        description: `Run agent-browser ${cmd}. :contentReference[oaicite:16]{index=16}`,
        inputSchema: {
          save_output_path: z.string().optional(),
          ...GlobalOptionsShape
        },
        outputSchema: OutputShape,
        annotations: {
          readOnlyHint: false,
          idempotentHint: false,
          destructiveHint: cmd === "close",
          openWorldHint: true
        }
      },
      async (input) => {
        const result = await runAgentBrowser({
          argv: [cmd],
          global: mapGlobalOptions(input),
          saveOutputPath: input.save_output_path
        });

        return {
          isError: !result.ok,
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result
        };
      }
    );
  }

  // session + session list
  server.registerTool(
    "agent_browser_session",
    {
      title: "agent-browser: session",
      description: "Show the current session name. :contentReference[oaicite:17]{index=17}",
      inputSchema: {
        save_output_path: z.string().optional(),
        ...GlobalOptionsShape
      },
      outputSchema: OutputShape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: true
      }
    },
    async (input) => {
      const result = await runAgentBrowser({
        argv: ["session"],
        global: mapGlobalOptions(input),
        saveOutputPath: input.save_output_path
      });

      return {
        isError: !result.ok,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );

  server.registerTool(
    "agent_browser_session_list",
    {
      title: "agent-browser: session list",
      description: "List active sessions. :contentReference[oaicite:18]{index=18}",
      inputSchema: {
        save_output_path: z.string().optional(),
        ...GlobalOptionsShape
      },
      outputSchema: OutputShape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: true
      }
    },
    async (input) => {
      const result = await runAgentBrowser({
        argv: ["session", "list"],
        global: mapGlobalOptions(input),
        saveOutputPath: input.save_output_path
      });

      return {
        isError: !result.ok,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );

  // connect <cdpPort>
  server.registerTool(
    "agent_browser_connect",
    {
      title: "agent-browser: connect",
      description:
        "Connect agent-browser to an existing Chrome DevTools Protocol port (CDP). After connect, commands can omit --cdp. ",
      inputSchema: {
        cdp_port: z.number().int().positive(),
        save_output_path: z.string().optional(),
        session: z.string().min(1).optional(),
        headed: z.boolean().optional(),
        debug: z.boolean().optional(),
        executable_path: z.string().min(1).optional(),
        json: z.boolean().optional(),
        timeout_ms: z.number().int().positive().optional()
      },
      outputSchema: OutputShape,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: true
      }
    },
    async (input) => {
      const result = await runAgentBrowser({
        argv: ["connect", String(input.cdp_port)],
        global: mapGlobalOptions(input),
        saveOutputPath: input.save_output_path
      });

      return {
        isError: !result.ok,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );

  // set headers <json>
  server.registerTool(
    "agent_browser_set_headers",
    {
      title: "agent-browser: set headers",
      description:
        "Set global headers (all domains) via `agent-browser set headers <json>`. Origin-scoped headers can also be set per-open with --headers. ",
      inputSchema: {
        headers: z.record(z.string()),
        save_output_path: z.string().optional(),
        ...GlobalOptionsShape
      },
      outputSchema: OutputShape,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: true
      }
    },
    async (input) => {
      const result = await runAgentBrowser({
        argv: ["set", "headers", JSON.stringify(input.headers)],
        global: mapGlobalOptions(input),
        saveOutputPath: input.save_output_path
      });

      return {
        isError: !result.ok,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );

  // Advanced: arbitrary subcommand passthrough (argv[0] must be allowlisted)
  server.registerTool(
    "agent_browser_command",
    {
      title: "agent-browser: command (advanced)",
      description:
        "Run an arbitrary agent-browser subcommand. argv[0] must be a known top-level command token; pass command-specific flags in argv. Use for features not covered by the dedicated tools.",
      inputSchema: {
        argv: z.array(z.string().min(1)).min(1),
        save_output_path: z.string().optional(),
        ...GlobalOptionsShape
      },
      outputSchema: OutputShape,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: true,
        openWorldHint: true
      }
    },
    async (input) => {
      const root = input.argv[0];
      if (!ALLOWED_ROOT_COMMANDS.has(root)) {
        const err = {
          ok: false,
          exitCode: -1,
          signal: null,
          invoked: { bin: process.env.AGENT_BROWSER_BIN || "agent-browser", args: [] },
          stdout: "",
          stderr: `Refused: argv[0]="${root}" not in allowlist`,
          parsedJson: null,
          truncated: false
        };
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify(err, null, 2) }],
          structuredContent: err
        };
      }

      const result = await runAgentBrowser({
        argv: input.argv,
        global: mapGlobalOptions(input),
        saveOutputPath: input.save_output_path
      });

      return {
        isError: !result.ok,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );
}
```

```ts
// path: agent-browser-mcp-server/src/index.ts
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { registerAgentBrowserTools } from "./tools/agentBrowserTools.js";

/**
 * stdio transport is appropriate for local CLI-style integrations. :contentReference[oaicite:21]{index=21}
 * Do not log to stdout in stdio servers; use stderr if you add diagnostics.
 */
async function main() {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION
  });

  registerAgentBrowserTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // stderr only; keep stdout clean for MCP protocol
  console.error(err);
  process.exit(1);
});
```

Notes relevant to the underlying repo behavior

* `snapshot -i` provides deterministic `@eN` refs intended for follow-on commands like `click @e2` and `fill @e3 "..."`.
* Sessions are a first-class concept (`--session`, `AGENT_BROWSER_SESSION`, and `session list`).
* CDP and headers workflows are supported by agent-browser (`connect <port>`, `--cdp <port>`, `--headers` on `open`, and `set headers`).
```

mcp/agent-browser-mcp-server/inspector.config.json
```
{
  "mcpServers": {
    "agent-browser": {
      "command": "node",
      "args": ["/home/user/project/temp/agent-browser/mcp/agent-browser-mcp-server/dist/index.js"],
      "env": {
        "AGENT_BROWSER_BIN": "/home/user/.local/share/pnpm/agent-browser"
      }
    }
  }
}
```

mcp/agent-browser-mcp-server/package.json
```
{
  "name": "agent-browser-mcp-server",
  "version": "1.0.0",
  "description": "MCP stdio server wrapper around agent-browser",
  "type": "module",
  "engines": {
    "node": ">=18"
  },
  "bin": {
    "agent-browser-mcp-server": "./dist/index.js"
  },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.1",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "typescript": "^5.7.3",
    "tsx": "^4.19.2",
    "@types/node": "^22.10.7"
  }
}
```

mcp/agent-browser-mcp-server/tsconfig.json
```
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

mcp/agent-browser-mcp-server/src/constants.ts
```

export const SERVER_NAME = 'agent-browser-mcp-server';
export const SERVER_VERSION = '1.0.0';

export const CHARACTER_LIMIT = 25000;
export const DEFAULT_TIMEOUT_MS = 60000;
export const DEFAULT_BIN = 'agent-browser';

export const ALLOWED_ROOT_COMMANDS = new Set([
  'open',
  'snapshot',
  'click',
  'fill',
  'type',
  'press',
  'connect',
  'session',
  'evaluate',
  'goto',
  'back',
  'forward',
  'refresh',
  'wait',
  'close',
  'reload',
  'headers',
  'set-headers'
]);

export const ERR_NOT_ALLOWED = 'Command not allowed';
export const ERR_TIMEOUT = 'Command timed out';
export const ERR_INVALID_INPUT = 'Invalid input';
```

mcp/agent-browser-mcp-server/src/index.ts
```
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
```

mcp/agent-browser-mcp-server/src/types.ts
```
export interface CliGlobalOptions {
  session?: string;
  cdpPort?: number;
  headed?: boolean;
  debug?: boolean;
  executablePath?: string;
  json?: boolean;
  timeoutMs?: number;
}

export interface CliRunRequest {
  argv: string[];
  options?: CliGlobalOptions;
  saveOutputPath?: string;
}

export interface CliInvocation {
  bin: string;
  args: string[];
}

export interface CliRunResult {
  ok: boolean;
  exitCode: number | null;
  signal: string | null;
  invoked: CliInvocation;
  stdout: string;
  stderr: string;
  parsedJson: unknown | null;
  truncated: boolean;
  savedOutputPath?: string;
  isError?: boolean;
}
```

mcp/agent-browser-mcp-server/src/services/agentBrowserCli.ts
```
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CliRunRequest, CliRunResult, CliGlobalOptions } from '../types.js';
import {
  CHARACTER_LIMIT,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_BIN,
  ERR_TIMEOUT,
  ERR_INVALID_INPUT,
} from '../constants.js';

export async function runAgentBrowser(request: CliRunRequest): Promise<CliRunResult> {
  const { argv, options, saveOutputPath } = request;

  // 1. Input Validation
  validateInput(argv, saveOutputPath);

  // 2. Prepare Command
  const bin = process.env.AGENT_BROWSER_BIN || DEFAULT_BIN;
  const args = [...argv];

  // Append global options
  if (options) {
    if (options.session) args.push('--session', options.session);
    if (options.cdpPort) args.push('--cdp-port', options.cdpPort.toString());
    if (options.headed) args.push('--headed');
    if (options.debug) args.push('--debug');
    if (options.executablePath) args.push('--executable-path', options.executablePath);
    // Default to json unless explicitly disabled (though CLI might not support --no-json, usually just omitting it implies text, but instructions say "Default to passing --json unless explicitly disabled")
    // If json is undefined or true, pass --json. If false, don't.
    if (options.json !== false) args.push('--json');
  } else {
    // Default behavior if options undefined
    args.push('--json');
  }

  // 3. Execution
  return new Promise((resolve) => {
    const timeoutMs = options?.timeoutMs || DEFAULT_TIMEOUT_MS;
    
    const child = spawn(bin, args, {
      shell: false,
      env: { ...process.env, NO_COLOR: '1' }, // Ensure clean output
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // Timeout handling
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // Force kill if it doesn't exit
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 5000);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        exitCode: null,
        signal: null,
        invoked: { bin, args },
        stdout: '',
        stderr: err.message,
        parsedJson: null,
        truncated: false,
        isError: true,
      });
    });

    child.on('close', async (code, signal) => {
      clearTimeout(timer);

      // Handle output saving
      if (saveOutputPath) {
        try {
          await fs.writeFile(saveOutputPath, stdout);
        } catch (writeErr: any) {
          stderr += `\nFailed to save output: ${writeErr.message}`;
        }
      }

      // Parse JSON
      let parsedJson: unknown | null = null;
      let truncated = false;

      // Try parsing JSON first (before truncation)
      // Only if we expect JSON (which we default to)
      try {
        // Attempt to find the last valid JSON object if mixed with logs
        // But for now, assume the CLI behaves well with --json.
        // Or simply try parsing the whole stdout.
        parsedJson = JSON.parse(stdout.trim());
      } catch (e) {
        // Not valid JSON
      }

      // Truncation Logic
      // "avoid truncating stdout when parsedJson is present. Otherwise truncate..."
      if (!parsedJson) {
        if (stdout.length > CHARACTER_LIMIT) {
          stdout = stdout.slice(0, CHARACTER_LIMIT) + '...[truncated]';
          truncated = true;
        }
      }
      
      if (stderr.length > CHARACTER_LIMIT) {
        stderr = stderr.slice(0, CHARACTER_LIMIT) + '...[truncated]';
      }

      const result: CliRunResult = {
        ok: code === 0 && !timedOut,
        exitCode: code,
        signal: signal,
        invoked: { bin, args },
        stdout,
        stderr: timedOut ? `${stderr}\n${ERR_TIMEOUT}` : stderr,
        parsedJson,
        truncated,
        savedOutputPath: saveOutputPath
      };

      resolve(result);
    });
  });
}

function validateInput(argv: string[], saveOutputPath?: string) {
  // Check NUL bytes
  for (const arg of argv) {
    if (arg.includes('\0')) {
      throw new Error(`${ERR_INVALID_INPUT}: NUL byte detected in argument`);
    }
  }

  // Check saveOutputPath
  if (saveOutputPath) {
    if (path.isAbsolute(saveOutputPath)) {
      throw new Error(`${ERR_INVALID_INPUT}: Absolute paths not allowed for output`);
    }
    // Simple traversal check
    const normalized = path.normalize(saveOutputPath);
    if (normalized.startsWith('..') || normalized.includes('..')) { // strict check
       throw new Error(`${ERR_INVALID_INPUT}: Path traversal not allowed`);
    }
    // Also NUL check for path
    if (saveOutputPath.includes('\0')) {
       throw new Error(`${ERR_INVALID_INPUT}: NUL byte in output path`);
    }
  }
}
```

mcp/agent-browser-mcp-server/src/tools/agentBrowserTools.ts
```
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
```

</source_code>