---
name: mcp-servers
description: Install, configure, authenticate, and troubleshoot MCP (Model Context Protocol) servers for this agent. Use when the user asks to add/install/remove an MCP server, connect a tool like Linear/Sentry/Supabase/GitHub via MCP, set up mcp.json, or when MCP tools are failing or need OAuth login.
---

# MCP servers

This agent has a built-in MCP client. Servers are declared in `mcp.json`; their tools
appear as `mcp_<server>_<tool>` once connected.

## Config files

| File | Scope |
| --- | --- |
| `~/.pi/agent/mcp.json` | global (all projects) |
| `<project>/.pi/mcp.json` | project-local, only honored in trusted projects |

Project entries override global entries with the same server name; project `settings`
keys override global ones per key. Prefer project-local config for project-specific
servers, global for personal/general-purpose ones. Create the file if it doesn't exist.

**Applying changes:** config is read at session start. After editing `mcp.json`, tell
the user to run `/reload` (this re-reads config, restarts servers, and refreshes tools).
You cannot run `/reload` yourself.

## Config format

```json
{
  "settings": {
    "toolPrefix": "mcp",
    "requestTimeoutMs": 30000,
    "maxRetries": 3
  },
  "mcpServers": {
    "<server-name>": { ... }
  }
}
```

`settings` is optional. Server names: keep them short and lowercase; they become part
of tool names.

### Local (stdio) server — spawned as a subprocess

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "env": { "SOME_VAR": "literal-value" }
    }
  }
}
```

- `command` is required; `transport` defaults to `"stdio"`.
- `env` values are literals merged over the parent environment — there is **no**
  `${VAR}` interpolation. If a server needs a secret, ask the user to provide it or
  reference their shell environment by launching via a wrapper script.
- Most published servers run via `npx -y <package>` (Node) or `uvx <package>` (Python).
  If unsure of the package name, search the web for "<product> MCP server".

### Remote (HTTP) server

```json
{
  "mcpServers": {
    "internal": {
      "transport": "streamable-http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer <api-key>" }
    }
  }
}
```

- `transport`: `"streamable-http"` (preferred) or `"sse"` (legacy); `url` required.
- `headers` is for static API-key auth. Never invent keys — ask the user for theirs.

### Remote server with OAuth (user login in browser)

```json
{
  "mcpServers": {
    "linear": {
      "transport": "streamable-http",
      "url": "https://mcp.linear.app/mcp",
      "auth": { "type": "oauth" }
    }
  }
}
```

- `auth: { "type": "oauth" }` is enough for most servers (discovery + dynamic client
  registration + PKCE are automatic). Optional fields: `scope`, `clientId`,
  `clientSecret`, `redirectUrl` (only for pre-registered clients), `clientName`.
- After `/reload`, the first connection will fail with "Authentication required" —
  that is expected. Start the login yourself with the `mcp_auth` tool (opens the
  user's browser), or tell the user to run `/mcp:auth <server-name>`. Tokens are
  stored and refreshed automatically afterwards.
- OAuth is only valid for `streamable-http`/`sse`, not `stdio`.
- If dynamic client registration is rejected (e.g. a client-name policy error), set
  `"clientName"` in the `auth` object and retry.

### Other per-server options

- `lifecycle`: `"eager"` (default, starts at session start) or `"lazy"` (started
  manually with `/mcp:start <name>`). Use lazy for rarely-used or slow servers.
- `requestTimeoutMs`, `healthCheckIntervalMs`: numeric overrides, rarely needed.

## Workflow for "install X MCP server"

1. Find the server's package name (stdio) or MCP endpoint URL (remote). Use web search
   if unsure; official docs usually show an `mcpServers` JSON snippet you can adapt.
2. Decide global vs project config; read the existing file first and merge — do not
   clobber other servers.
3. Write the config. Validate: stdio needs `command`; http/sse needs `url`.
4. Ask the user to run `/reload`, then `/mcp` to confirm the server is `ready`. If it
   uses OAuth, start the login with the `mcp_auth` tool once the server exists.

## Agent tool

- `mcp_auth` (`{ "server": "<name>" }`): queues the interactive browser OAuth flow for
  a configured server. Use it when the user asks you to log in / authenticate an MCP
  server. The flow starts after your turn ends; the user completes it in the browser.

## Commands (user-facing — suggest these, you cannot run them)

| Command | Purpose |
| --- | --- |
| `/mcp` | status of all servers |
| `/mcp <name>` | state, last error, recent server logs |
| `/mcp:start <name>` / `/mcp:stop <name>` | start/stop a server |
| `/mcp:auth <name> [reset]` | browser OAuth login (`reset` wipes stored credentials) |
| `/reload` | apply mcp.json changes |

## Troubleshooting

- Server stuck at `stopped` with an error: suggest `/mcp <name>` to see its stderr log.
  Common causes: package name typo, missing runtime (`npx`/`uvx` not installed),
  missing env var/API key, wrong URL.
- `401`/`Unauthorized` on an OAuth server: `mcp_auth` tool or `/mcp:auth <name>`; if
  it keeps failing, `/mcp:auth <name> reset`.
- OAuth registration rejected with a client-name error: set `"clientName"` in the
  server's `auth` config to a compliant name, `/reload`, and retry the login.
- Tools missing after config edit: `/reload` was probably not run.
- Project config ignored: the project may not be trusted; move the server to
  `~/.pi/agent/mcp.json` or have the user trust the project.
