1. Overview

Problem statement. MCP clients (LLM agents, IDEs, automation runners) need a reliable way to drive a real browser locally, with deterministic follow-up actions, without embedding a full browser automation stack inside the MCP server. The `agent-browser` CLI already supports a high-signal workflow (open → snapshot with stable element refs → act via refs → re-snapshot). The missing piece is a thin MCP stdio server that exposes this workflow as typed MCP tools with bounded outputs and predictable machine-readable results.

Who has it (target users).

* Agent / toolchain developers integrating browser control into MCP-enabled runtimes.
* Power users running local automations through an MCP client (desktop, IDE, or CLI).
* QA / scraping / ops engineers who want repeatable, scriptable browser actions via MCP.

Why current solutions fail.

* Raw CLI invocation from an MCP client lacks consistent tool schemas, structured output, and safe output bounding.
* Direct Playwright/Selenium embedding increases dependency footprint and operational complexity compared to shelling out to an already-installed `agent-browser`.
* Unbounded stdout (e.g., large snapshots) can exceed MCP client limits unless truncation/filters and “save output to file” are first-class.

Success metrics (measurable).

* Tool invocation reliability: ≥ 99% of calls return a well-formed MCP tool response, including on CLI errors.
* Structured output availability: ≥ 95% of successful calls populate `parsedJson` when `--json` is enabled.
* Output safety: stdout/stderr returned to the MCP client never exceed configured bounds (except when returning valid JSON that must remain intact), and truncation is explicitly flagged.
* Determinism for follow-up actions: snapshot + `@eN` refs round-trip yields successful click/fill/type in ≥ 95% of common pages (measured via sample suite).

1. Capability Tree (Functional Decomposition)

### Capability: MCP Server Runtime

Provides a stdio MCP server process that registers tools and communicates over MCP without polluting stdout.

#### Feature: Stdio server bootstrap (MVP)

* Description: Start an MCP server over stdio and register agent-browser tools.
* Inputs: Process start; optional environment variables.
* Outputs: MCP server ready to accept tool calls.
* Behavior: Create `McpServer`, register tools, connect using `StdioServerTransport`, log only to stderr on fatal errors.

#### Feature: Server identity (MVP)

* Description: Expose stable server name/version.
* Inputs: None.
* Outputs: Name/version metadata.
* Behavior: Use exported constants for server metadata.

### Capability: CLI Invocation + Result Normalization

Runs the installed `agent-browser` binary safely (no shell), applies global options, bounds outputs, and returns a normalized result object.

#### Feature: Binary resolution (MVP)

* Description: Locate `agent-browser` executable from env or PATH default.
* Inputs: `AGENT_BROWSER_BIN` env var (optional).
* Outputs: Resolved binary string.
* Behavior: Prefer `AGENT_BROWSER_BIN`, else default to `agent-browser`.

#### Feature: Global option mapping (MVP)

* Description: Convert MCP tool inputs into CLI global flags.
* Inputs: `session`, `cdp_port`, `headed`, `debug`, `executable_path`, `json`, `timeout_ms`.
* Outputs: Ordered argv segment for global flags.
* Behavior: Apply `--session` (including `AGENT_BROWSER_SESSION` fallback), `--cdp`, `--headed`, `--debug`, `--executable-path`; default `--json` unless explicitly disabled.

#### Feature: Argument sanitation (MVP)

* Description: Reject unsafe/invalid argv tokens passed to child process.
* Inputs: Each arg string.
* Outputs: Sanitized arg string or error.
* Behavior: Reject NUL bytes and overly long args to prevent unexpected behavior.

#### Feature: Timeout enforcement (MVP)

* Description: Kill stalled CLI processes.
* Inputs: `timeout_ms` (optional); default timeout.
* Outputs: CLI run result indicating termination if killed.
* Behavior: Use a kill timer; send SIGKILL when timeout elapses; default 60s.

#### Feature: Output truncation and flags (MVP)

* Description: Keep stdout/stderr bounded for MCP clients and mark truncation.
* Inputs: Captured stdout/stderr.
* Outputs: Possibly truncated `stdout`/`stderr` and `truncated: boolean`.
* Behavior: Truncate to a configured character limit; avoid truncating when JSON parsing succeeds (to preserve parseable JSON).

#### Feature: JSON parsing (MVP)

* Description: Parse JSON output when `--json` is used.
* Inputs: stdout string.
* Outputs: `parsedJson` object/array or null.
* Behavior: Attempt JSON.parse if stdout looks like JSON; store parsed value.

#### Feature: Save output to file (MVP)

* Description: Persist full stdout to a relative path to bypass MCP response size limits.
* Inputs: `save_output_path` relative path.
* Outputs: `savedOutputPath` in result.
* Behavior: Validate relative paths (no absolute, no traversal), mkdirp the directory, write stdout, return the saved path.

### Capability: Core Browser Workflow Tools

Expose the recommended “open → snapshot (-i) → act via @refs” loop as dedicated MCP tools with typed schemas.

#### Feature: Open URL (MVP)

* Description: Navigate to a URL.
* Inputs: `url`; optional per-open `headers`; global options; optional `save_output_path`.
* Outputs: Normalized CLI run result.
* Behavior: Execute `agent-browser open <url>`; if headers supplied, add `--headers <json>` for origin-scoped headers.

#### Feature: Snapshot (MVP)

* Description: Capture a page snapshot, optionally with interactive refs for deterministic follow-ups.
* Inputs: `interactive`, `compact`, `depth`, `selector`; global options; optional `save_output_path`.
* Outputs: Normalized result; snapshot content via stdout/parsedJson or saved file.
* Behavior: Execute `agent-browser snapshot` with flags (`-i`, `-c`, `-d`, `-s`) and encourage refs (`@eN`).

#### Feature: Click element (MVP)

* Description: Click an element by selector or `@ref`.
* Inputs: `target`; global options; optional `save_output_path`.
* Outputs: Normalized result.
* Behavior: Execute `agent-browser click <target>`; designed to prefer `@ref` from interactive snapshots.

#### Feature: Fill input (MVP)

* Description: Clear and enter a value into an input by selector or `@ref`.
* Inputs: `target`, `value`; global options; optional `save_output_path`.
* Outputs: Normalized result.
* Behavior: Execute `agent-browser fill <target> <value>`.

#### Feature: Type into input (MVP)

* Description: Type text without clearing.
* Inputs: `target`, `text`; global options; optional `save_output_path`.
* Outputs: Normalized result.
* Behavior: Execute `agent-browser type <target> <text>`.

#### Feature: Press key (MVP)

* Description: Press a key chord (e.g., Enter, Control+a).
* Inputs: `key`; global options; optional `save_output_path`.
* Outputs: Normalized result.
* Behavior: Execute `agent-browser press <key>`.

#### Feature: Navigation controls (MVP)

* Description: Back/forward/reload/close.
* Inputs: Global options; optional `save_output_path`.
* Outputs: Normalized result.
* Behavior: Execute `agent-browser back|forward|reload|close`; mark `close` as destructive.

### Capability: Session and Connection Management

Expose session isolation and CDP connectivity patterns supported by `agent-browser`.

#### Feature: Session name (MVP)

* Description: Return current session identifier.
* Inputs: Global options; optional `save_output_path`.
* Outputs: Normalized result.
* Behavior: Execute `agent-browser session`; mark read-only + idempotent.

#### Feature: Session list (MVP)

* Description: List active sessions.
* Inputs: Global options; optional `save_output_path`.
* Outputs: Normalized result.
* Behavior: Execute `agent-browser session list`; mark read-only + idempotent.

#### Feature: Connect to CDP port (MVP)

* Description: Connect `agent-browser` to an existing Chrome DevTools Protocol port.
* Inputs: `cdp_port`; global options; optional `save_output_path`.
* Outputs: Normalized result.
* Behavior: Execute `agent-browser connect <port>`; after connect, commands may omit `--cdp`.

### Capability: Header Management

Support origin-scoped headers for open and global headers across all domains.

#### Feature: Per-open origin-scoped headers (MVP)

* Description: Set headers for the navigation’s origin.
* Inputs: `headers` record; used with Open URL.
* Outputs: Normalized result.
* Behavior: Add `--headers <json>` to `open` call.

#### Feature: Global headers (MVP)

* Description: Set headers applied globally by agent-browser.
* Inputs: `headers` record; global options; optional `save_output_path`.
* Outputs: Normalized result.
* Behavior: Execute `agent-browser set headers <json>`.

### Capability: Advanced Command Passthrough

Expose a controlled “escape hatch” for commands not covered by dedicated tools.

#### Feature: Allowlisted root command passthrough (MVP)

* Description: Run an arbitrary agent-browser subcommand with argv array input, restricted by an allowlist of root commands.
* Inputs: `argv[]` where `argv[0]` is a top-level command token; global options; optional `save_output_path`.
* Outputs: Normalized result; explicit error if disallowed.
* Behavior: Reject non-allowlisted `argv[0]`; never invoke a shell; mark tool as destructive to discourage casual use.

1. Repository Structure + Module Definitions (Structural Decomposition)

Repository structure (current target baseline).

```
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

### Module: constants

* Maps to capability: MCP Server Runtime + CLI Invocation (shared configuration)
* Responsibility: Centralize immutable server/CLI defaults and policy constants.
* File structure:

  * `src/constants.ts`
* Exports:

  * `SERVER_NAME`, `SERVER_VERSION`
  * `CHARACTER_LIMIT`, `DEFAULT_TIMEOUT_MS`, `DEFAULT_BIN`
  * `ALLOWED_ROOT_COMMANDS`

### Module: types

* Maps to capability: CLI Invocation + Result Normalization
* Responsibility: Define typed contracts for CLI run requests, global options, and normalized results.
* File structure:

  * `src/types.ts`
* Exports:

  * `CliGlobalOptions`, `CliRunRequest`, `CliRunResult`

### Module: services/agentBrowserCli

* Maps to capability: CLI Invocation + Result Normalization
* Responsibility: Execute the `agent-browser` process, apply global args, enforce timeouts, parse JSON, truncate outputs, and optionally save stdout to disk.
* File structure:

  * `src/services/agentBrowserCli.ts`
* Exports:

  * `runAgentBrowser(req: CliRunRequest): Promise<CliRunResult>`

### Module: tools/agentBrowserTools

* Maps to capability: Core Browser Workflow Tools + Session/Connection + Headers + Advanced Passthrough
* Responsibility: Define MCP tool schemas (Zod), map tool inputs to CLI argv, invoke `runAgentBrowser`, and return MCP tool responses.
* File structure:

  * `src/tools/agentBrowserTools.ts`
* Exports:

  * `registerAgentBrowserTools(server: McpServer): void`

### Module: server entrypoint

* Maps to capability: MCP Server Runtime
* Responsibility: Construct MCP server, register tools, connect stdio transport, handle fatal errors on stderr only.
* File structure:

  * `src/index.ts`
* Exports:

  * None (CLI entrypoint).

1. Dependency Chain (layers, explicit “Depends on: […]”)

Foundation layer (no dependencies):

* constants: Depends on: []
* types: Depends on: []

Service layer:

* services/agentBrowserCli: Depends on: [constants, types]

Tooling layer:

* tools/agentBrowserTools: Depends on: [services/agentBrowserCli, constants, types]

Runtime layer:

* index (server bootstrap): Depends on: [tools/agentBrowserTools, constants]

Docs/config layer:

* README + package.json/tsconfig: Depends on: [runtime layer] (for accuracy of instructions and tool list).

1. Development Phases (Phase 0…N; entry/exit criteria; tasks with dependencies + acceptance criteria + test strategy)

### Phase 0: Contracts and constants (Foundation)

Entry criteria: Empty TS project with build tooling.
Tasks:

* [ ] Define server/CLI constants (depends on: none)

  * Acceptance criteria: `SERVER_NAME`, `SERVER_VERSION`, defaults, and allowlist are exported and unit-testable.
  * Test strategy: Unit test exports; snapshot test allowlist contents.
* [ ] Define CLI request/result types (depends on: none)

  * Acceptance criteria: `CliGlobalOptions`, `CliRunRequest`, `CliRunResult` compile and match usage in service/tool layers.
  * Test strategy: Type-level tests (tsd-style) or compilation checks in CI.

Exit criteria: Other modules can import constants/types with no circular deps.

### Phase 1: CLI runner service (Service layer)

Entry criteria: Phase 0 complete.
Tasks:

* [ ] Implement arg sanitation + global arg builder (depends on: [Phase 0 tasks])

  * Acceptance criteria: Reject NUL/oversize args; construct argv including session fallback and default `--json`.
  * Test strategy: Unit tests for sanitize/buildGlobalArgs across input combinations.
* [ ] Implement process execution + timeout (depends on: [previous task])

  * Acceptance criteria: Uses `spawn` with `shell: false`; kills after configured timeout; returns exit code/signal.
  * Test strategy: Integration tests with a stub executable that sleeps; verify SIGKILL behavior.
* [ ] Implement JSON parse + bounded output + truncation flags (depends on: [previous task])

  * Acceptance criteria: `parsedJson` populated when stdout is valid JSON; truncation applies to non-JSON stdout and stderr; `truncated` flag correct.
  * Test strategy: Unit tests with crafted stdout/stderr; property tests around boundary sizes.
* [ ] Implement safe saveOutputPath writing (depends on: [previous task])

  * Acceptance criteria: Absolute paths and traversal are rejected; relative paths write stdout; `savedOutputPath` returned.
  * Test strategy: Unit tests for path validation; integration test writes into temp directory.

Exit criteria: `runAgentBrowser()` is stable and returns a normalized `CliRunResult` for success/failure.

### Phase 2: MCP tool schemas and mappings (Tooling layer)

Entry criteria: Phase 1 complete.
Tasks:

* [ ] Implement shared Zod schemas + global option mapping (depends on: [Phase 1])

  * Acceptance criteria: Tool input schemas include global options; mapping aligns with CLI flags.
  * Test strategy: Unit tests validating Zod parsing defaults; mapping unit tests.
* [ ] Implement MVP tool set: open/snapshot/click/fill/type/press (depends on: [previous task])

  * Acceptance criteria: Each tool calls `runAgentBrowser` with correct argv; returns MCP `structuredContent` mirroring `CliRunResult`.
  * Test strategy: Integration tests with stub agent-browser binary capturing argv; verify tool → argv mapping.
* [ ] Implement navigation + session + connect + set headers tools (depends on: [previous task])

  * Acceptance criteria: back/forward/reload/close, session/session list, connect, set headers are registered with correct annotations and argv.
  * Test strategy: Same stub-binary integration tests; verify “close” marked destructive.
* [ ] Implement advanced passthrough tool with allowlist (depends on: [Phase 0 constants, Phase 1 service])

  * Acceptance criteria: Rejects non-allowlisted root tokens; otherwise passes argv through; no shell usage.
  * Test strategy: Unit tests for allowlist rejection; integration tests for argv passthrough.

Exit criteria: MCP tool surface supports the recommended workflow end-to-end.

### Phase 3: Server entrypoint + packaging (Runtime layer)

Entry criteria: Phase 2 complete.
Tasks:

* [ ] Implement stdio bootstrap (depends on: [Phase 2])

  * Acceptance criteria: Server starts; registers tools; connects stdio transport; errors go to stderr only.
  * Test strategy: End-to-end test launching node process and performing a minimal MCP handshake (or SDK-level harness).
* [ ] Document install/run and environment variables (depends on: [previous task])

  * Acceptance criteria: README describes prerequisites (`agent-browser install`), env vars, and recommended tool flow.
  * Test strategy: Docs lint/check that tool names in README match registrations.

Exit criteria: Users can configure an MCP client to run the server and drive a browser using the MVP loop.

### Phase 4: Expanded first-class tool coverage (Post-MVP)

Entry criteria: Phase 3 complete.
Tasks (parallelizable; all depend on Phase 3):

* [ ] Add dedicated tools for common commands currently only reachable via passthrough (e.g., hover/check/uncheck/upload/get/find/tab/session management extensions), prioritizing high-frequency agent actions.

  * Acceptance criteria: Each new tool has explicit Zod schema, maps to a single CLI subcommand, and includes safe annotations.
  * Test strategy: Stub-binary argv verification + one real-browser smoke test suite (optional/flagged).

Exit criteria: “Advanced passthrough” is rarely needed for common workflows.

1. User Experience

Personas.

* MCP-integrated agent developer: needs stable tool schemas and deterministic browser actions for autonomous agents.
* Automation power user: wants “open → snapshot → click/fill → snapshot” loops without writing a full automation harness.

Key flows.

* Deterministic interaction loop: `agent_browser_open` → `agent_browser_snapshot` with `interactive=true` → act using `@eN` refs via `agent_browser_click/fill/type` → re-snapshot to confirm state.
* Large snapshot handling: call snapshot with filters (`compact/depth/selector`) or use `save_output_path` to write stdout to disk and return only metadata.
* Multi-session isolation: set `AGENT_BROWSER_SESSION` or pass `session` per tool call; use `session list` for inspection.
* Existing browser attach: use `agent_browser_connect` to attach to a CDP port, then issue actions without per-call `--cdp`.

UI/UX notes (tool surface).

* Tool names should remain stable (`agent_browser_*`) and align with CLI verbs.
* Schemas should default to safe, predictable behavior (e.g., snapshot defaults to interactive+compact+depth).
* Error reporting should be uniform: CLI failures still return a structured result with stderr and exit codes.

1. Technical Architecture

System components.

* MCP stdio server (Node + MCP SDK) that registers tools and communicates over stdio.
* CLI runner service that executes `agent-browser` via `spawn` without a shell, captures output, optionally parses JSON, truncates safely, and can persist stdout to a file.
* Tool registry that maps MCP tool inputs to CLI argv and returns normalized results.

Primary integration: `agent-browser` CLI.

* Server assumes `agent-browser` is installed and available on PATH or via `AGENT_BROWSER_BIN`.
* Chromium installation is delegated to `agent-browser install` / `--with-deps`.

Data models.

* CLI request: argv + global options + optional save path.
* CLI result: `ok`, `exitCode`, `signal`, `invoked`, `stdout`, `stderr`, `parsedJson`, `truncated`, optional `savedOutputPath`.

Key decisions and trade-offs.

* Shelling out vs embedding browser automation: reduces dependency surface and leverages existing CLI, but requires managing installed binary compatibility and output size constraints.
* Output bounding via truncation + optional file save: protects MCP clients, but introduces file IO considerations and path validation requirements.
* Allowlisted passthrough: increases flexibility without exposing arbitrary command execution beyond intended CLI root verbs (not a full security boundary, but reduces accidental misuse).

1. Test Strategy

Test pyramid targets.

* Unit: ~70% (pure functions: arg building, truncation, JSON parsing heuristics, path validation, allowlist checks).
* Integration: ~25% (tool→argv mapping using stub executable; CLI runner with controlled subprocesses).
* End-to-end: ~5% (optional real `agent-browser` smoke tests gated by environment).

Coverage minimums.

* Line: 85%+
* Branch: 80%+
* Function: 85%+

Critical scenarios per module.

* constants/types

  * Happy path: exports exist and are consistent.
  * Edge: allowlist contains only intended root verbs.
* services/agentBrowserCli

  * Happy: stdout JSON parses; `parsedJson` set; no truncation of JSON.
  * Edge: stdout > limit and non-JSON truncates with `truncated=true`.
  * Error: timeout triggers SIGKILL; result reflects termination.
  * Security hygiene: traversal paths rejected; absolute paths rejected.
* tools/agentBrowserTools

  * Happy: each tool generates correct argv sequence and forwards global options.
  * Error: passthrough rejects non-allowlisted argv[0] with structured error.
* index

  * Happy: server boots and registers tools; no stdout logging outside MCP protocol.

1. Risks and Mitigations

Technical risks.

* Risk: `agent-browser` CLI output formats or flags change, breaking parsing or tool mappings.

  * Impact: High
  * Likelihood: Medium
  * Mitigation: Pin supported CLI versions in docs; add stub-binary integration tests that assert argv and result parsing; treat JSON parsing as best-effort (`parsedJson` nullable).
  * Fallback: Route unsupported actions through passthrough while adding new dedicated tools.

* Risk: Large snapshots exceed client limits or cause truncation that breaks downstream usage.

  * Impact: High
  * Likelihood: High
  * Mitigation: Default snapshot filters (compact, depth); preserve valid JSON untruncated; support `save_output_path` for full output.
  * Fallback: Encourage selector-targeted snapshots; document best practices.

Dependency risks.

* Risk: Chromium install / system dependencies vary across OSes, causing flaky runtime behavior.

  * Impact: High
  * Likelihood: Medium
  * Mitigation: Document `agent-browser install --with-deps` for Linux; provide troubleshooting section; optionally add a “health check” tool later.
  * Fallback: Support CDP connect mode to use an existing managed Chrome.

Scope risks.

* Risk: Adding too many dedicated tools duplicates the CLI surface and increases maintenance.

  * Impact: Medium
  * Likelihood: High
  * Mitigation: Keep MVP tool set small; expand only for high-frequency actions; keep passthrough for long tail.
  * Fallback: Maintain only the “high-signal” subset plus passthrough.

1. Appendix

References (provided context).

* agent-browser-mcp-server README, constants, types, CLI runner, tool registry, server entrypoint.
* Notes on recommended `agent-browser` workflow and interactive refs (`@eN`).

Glossary.

* MCP: Model Context Protocol.
* stdio transport: MCP transport over stdin/stdout.
* CDP: Chrome DevTools Protocol.
* `@eN` refs: Deterministic element references produced by `snapshot -i`.

Open questions (assumptions to validate).

* Which additional CLI subcommands should be promoted from passthrough into first-class tools (priority list and schemas)?
* Should `save_output_path` default to a specific server-managed directory to simplify client usage (while preserving traversal safety)?
* Should the server support concurrent tool calls per session, or enforce a per-session mutex to avoid overlapping CLI interactions?
