# agent-browser-mcp-server

An MCP (Model Context Protocol) server that wraps the `agent-browser` CLI, enabling LLMs to interact with a web browser using natural language commands.

## Prerequisites

- **Node.js**: Version 18 or higher.
- **agent-browser CLI**: The `agent-browser` executable must be installed and available on your system.
  - Ensure it is in your system `PATH` or configured via the `AGENT_BROWSER_BIN` environment variable.

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd agent-browser-mcp-server
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

## Configuration

You can configure the server using environment variables. These can be set in your shell or passed via your MCP client configuration.

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENT_BROWSER_BIN` | Path to the `agent-browser` executable. | `agent-browser` |
| `AGENT_BROWSER_SESSION` | Default session ID to use if not specified in tool calls. | `undefined` |

## Tools

The server exposes the following tools to the MCP client:

### Core Browser Tools

- **`agent_browser_open`**: Open a URL in the browser.
  - Arguments: `url` (string), `headers` (optional object).
- **`agent_browser_snapshot`**: Take a snapshot of the current page state.
  - Arguments: `selector` (optional), `interactive` (default: true), `compact` (default: true), `depth` (default: 5).
- **`agent_browser_click`**: Click an element.
  - Arguments: `ref` (string - from snapshot).
- **`agent_browser_fill`**: Fill an input element.
  - Arguments: `ref` (string), `value` (string).
- **`agent_browser_type`**: Type text into an element.
  - Arguments: `ref` (string), `value` (string).
- **`agent_browser_press`**: Press a key.
  - Arguments: `key` (string).

### Navigation & Session

- **`agent_browser_back`**: Navigate back.
- **`agent_browser_forward`**: Navigate forward.
- **`agent_browser_reload`**: Reload page.
- **`agent_browser_close`**: Close the browser/page.
- **`agent_browser_session`**: Get current session ID.
- **`agent_browser_session_list`**: List active sessions.

### Advanced

- **`agent_browser_connect`**: Connect to an existing Chrome DevTools Protocol (CDP) port.
  - Arguments: `port` (number).
- **`agent_browser_set_headers`**: Set custom HTTP headers for the session.
  - Arguments: `headers` (object).
- **`agent_browser_command`**: Run a raw `agent-browser` command (restricted to allowlisted commands).
  - Arguments: `argv` (array of strings).

## Client Integration

To use this server with Claude Desktop or other MCP clients, add the following to your configuration file (e.g., `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "agent-browser": {
      "command": "node",
      "args": [
        "/absolute/path/to/agent-browser-mcp-server/dist/index.js"
      ],
      "env": {
        "AGENT_BROWSER_BIN": "/path/to/agent-browser"
      }
    }
  }
}
```

## Recommended Workflow

1. **Open a Page**: Use `agent_browser_open` with a URL.
2. **Analyze State**: Use `agent_browser_snapshot` to get a structured view of the page with interactive element references (IDs).
3. **Interact**: Use `agent_browser_click`, `agent_browser_fill`, etc., using the numeric references returned in the snapshot.
4. **Verify**: Take another snapshot to confirm the action had the desired effect.

## Development

- **Build**: `npm run build`
- **Watch**: `npm run dev`

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector --config ./inspector.config.json --server agent-browser
```
