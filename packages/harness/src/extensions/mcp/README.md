# mcp — MCP client extension

Connects pi to [Model Context Protocol](https://modelcontextprotocol.io) servers and registers
their tools as pi tools. In-house replacement for the community `pi-mcp-adapter`.

## Configuration

Config is merged from two `mcp.json` files (project overrides global per key; project servers
replace same-named global servers wholesale):

| Location | Scope |
| --- | --- |
| `~/.pi/agent/mcp.json` | global |
| `<project>/.pi/mcp.json` | project-local — only honored when the project is trusted |

```json
{
  "settings": {
    "toolPrefix": "mcp",
    "requestTimeoutMs": 30000,
    "maxRetries": 3
  },
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "env": { "NODE_ENV": "production" },
      "lifecycle": "eager"
    },
    "internal-api": {
      "transport": "streamable-http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer <api-key>" },
      "lifecycle": "lazy"
    },
    "linear": {
      "transport": "streamable-http",
      "url": "https://mcp.linear.app/mcp",
      "auth": { "type": "oauth" }
    }
  }
}
```

### Server options

| Field | Type / values | Default | Notes |
| --- | --- | --- | --- |
| `transport` | `"stdio" \| "streamable-http" \| "sse"` | `"stdio"` | |
| `command`, `args`, `env` | | | stdio only; `command` required |
| `url` | URL | | required for streamable-http / sse |
| `headers` | record | | static HTTP headers (API-key auth) |
| `auth` | object | | OAuth config, http/sse only (below) |
| `lifecycle` | `"eager" \| "lazy"` | `"eager"` | eager starts at `session_start`; lazy via `/mcp:start` |
| `requestTimeoutMs` | number | settings value | per-request timeout override |
| `healthCheckIntervalMs` | number | disabled | opt-in ping; reconnects on failure |

### Settings

| Field | Default | Notes |
| --- | --- | --- |
| `toolPrefix` | `"mcp"` | tool names are `<prefix>_<server>_<tool>` (sanitized to `[a-zA-Z0-9_]`, ≤64 chars with hash suffix on truncation) |
| `requestTimeoutMs` | `30000` | default per-request timeout |
| `maxRetries` | `3` | reconnect attempts (fixed 1s/3s/5s/10s/30s schedule) |

## OAuth (`auth`)

Authorization-code + PKCE against the server's advertised authorization server: RFC 9728 /
metadata discovery, dynamic client registration (or a pre-registered client), browser
authorization via a loopback callback, token exchange, and silent refresh on reconnect.

```json
"auth": {
  "type": "oauth",
  "scope": "read write",
  "clientId": "pre-registered-id",
  "clientSecret": "…",
  "redirectUrl": "http://127.0.0.1:19876/callback",
  "clientName": "PostHog Code"
}
```

All fields except `type` are optional. Without `clientId`, the client is registered dynamically.
Without `redirectUrl`, the callback server binds an ephemeral 127.0.0.1 port; set it only when a
pre-registered client requires an exact redirect URI (must be an `http://` loopback URL with an
explicit port).

Credentials are stored per server under `~/.pi/agent/mcp-auth/<sha256(name)>.json` (mode 0600),
scoped to the configured server URL — changing the URL invalidates them. Background reconnects
attach and refresh tokens silently but never open a browser or register clients; when a fresh
authorization is needed the connection fails with a hint to run `/mcp:auth <server>`.

The `client_credentials` grant (machine-to-machine, no user) is not implemented — use static
`headers` for that case.

## Commands

| Command | Purpose |
| --- | --- |
| `/mcp` | status summary for all servers |
| `/mcp <name>` | state, retries, last error, tools, recent logs |
| `/mcp:start <name>` | start a server (lazy servers, or after failure) |
| `/mcp:stop <name>` | stop a server and deactivate its tools |
| `/mcp:auth` | list OAuth-enabled servers with auth status |
| `/mcp:auth <name> [reset]` | run the browser OAuth flow (`reset` clears stored credentials first) |

The model can start the OAuth flow itself via the `mcp_auth` tool, which queues
`/mcp:auth <server>` as a follow-up user message ("log in to linear for me" works).

## Bundled skill

The extension contributes an `mcp-servers` skill (`skills/mcp-servers/SKILL.md`) via
`resources_discover`, so the model can handle "install/configure the X MCP server" requests
itself: it knows the config schema, file locations and trust rules, the OAuth setup +
`/mcp:auth` handoff, that `/reload` applies config changes, and how to troubleshoot via
`/mcp <name>`. Only the one-line description sits in the system prompt; the full instructions
load on demand (progressive disclosure).

## Behavior notes

- Tools are registered once and **activated/deactivated** as servers connect/disconnect, so tool
  identities stay stable across reconnects (no churn in pi's tool registry).
- Crashed or dropped connections are detected via the client's close event: the server flips to
  `stopped`, its tools deactivate, and a background reconnect (re)activates them on success.
- Tool-name collisions (two MCP tools sanitizing to the same pi name) are reported in
  `/mcp <name>`; the later definition wins.
- `notifications/tools/list_changed` triggers live tool re-discovery; `tools/list` pagination is
  followed per spec (with a 100-page guard).
- Tool annotations (`readOnlyHint`, `destructiveHint`, …) are appended to tool descriptions.
- Tool-call `AbortSignal`s propagate to the SDK (`notifications/cancelled`).
- MCP text/image result content passes through; audio/resource content is described as text.
- Server stderr and `notifications/message` logs land in a per-server ring buffer (`/mcp <name>`).

## Module map

| File | Responsibility |
| --- | --- |
| `extension.ts` | pi wiring: lifecycle, commands, notifications |
| `config.ts` | zod schemas, load + merge of the two `mcp.json` files |
| `server-manager.ts` | connection lifecycle, retries, health checks, transports |
| `tool-bridge.ts` | MCP tools ⇄ pi tools (naming, schema conversion, execution) |
| `schema.ts` | JSON Schema → TypeBox conversion |
| `render.ts` | TUI call renderer (shows tool arguments inline; full JSON when expanded) |
| `auth-storage.ts` / `oauth-provider.ts` / `callback-server.ts` / `auth-flow.ts` | OAuth |
| `skills/mcp-servers/` | bundled skill teaching the model to install/configure servers |
| `test-support.ts` | in-memory MCP server + fake OAuth server (tests only) |
