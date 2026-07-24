// Host-agnostic shapes for the user's locally configured MCP servers
// (~/.posthog-code/mcp.json) as they relate to task runs. The workspace-server
// reads the config from disk; @posthog/core classifies each server by whether
// it can be imported into a cloud sandbox.

export type LocalMcpServerScope = "user" | "project";

/**
 * Normalized transport of a locally configured MCP server. `unknown` covers
 * entries whose shape we don't recognize (e.g. future config formats); they
 * are surfaced but never imported.
 */
export type LocalMcpTransport =
  | { type: "http" | "sse"; url: string; headers?: Record<string, string> }
  | { type: "stdio"; command: string; args?: string[] }
  | { type: "unknown" };

export type PostHogMcpServerConfig =
  | {
      type?: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  | {
      type: "http";
      url: string;
      headers?: Record<string, string>;
    };

export interface ParsedPostHogMcpServer {
  name: string;
  config: PostHogMcpServerConfig | null;
}

function stringRecord(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.some(([, entry]) => typeof entry !== "string")) return null;
  return Object.fromEntries(entries) as Record<string, string>;
}

export function parsePostHogMcpServers(
  value: unknown,
): ParsedPostHogMcpServer[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const servers = (value as { mcpServers?: unknown }).mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    return [];
  }

  return Object.entries(servers).map(([name, raw]) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { name, config: null };
    }
    const config = raw as Record<string, unknown>;
    if (config.type === "http" && typeof config.url === "string") {
      const headers =
        config.headers === undefined ? undefined : stringRecord(config.headers);
      if (headers === null) return { name, config: null };
      return {
        name,
        config: {
          type: "http" as const,
          url: config.url,
          ...(headers !== undefined ? { headers } : {}),
        },
      };
    }
    if (
      (config.type === undefined || config.type === "stdio") &&
      typeof config.command === "string"
    ) {
      const args = config.args;
      const env =
        config.env === undefined ? undefined : stringRecord(config.env);
      if (
        (args !== undefined &&
          (!Array.isArray(args) ||
            args.some((entry) => typeof entry !== "string"))) ||
        env === null
      ) {
        return { name, config: null };
      }
      return {
        name,
        config: {
          type: "stdio" as const,
          command: config.command,
          ...(args !== undefined ? { args: args as string[] } : {}),
          ...(env !== undefined ? { env } : {}),
        },
      };
    }
    return { name, config: null };
  });
}

export function validatePostHogMcpConfig(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return ["Configuration must be a JSON object"];
  }
  const servers = (value as { mcpServers?: unknown }).mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    return ["mcpServers must be an object"];
  }
  return parsePostHogMcpServers(value)
    .filter((entry) => entry.config === null)
    .map((entry) => `Invalid MCP server configuration: ${entry.name}`);
}

/**
 * A locally configured MCP server as reported by the workspace-server.
 * Deliberately excludes stdio `env` values, which routinely hold secrets the
 * renderer has no use for.
 */
export interface LocalMcpServerDescriptor {
  name: string;
  scope: LocalMcpServerScope;
  transport: LocalMcpTransport;
}

/**
 * A local MCP server in the shape the cloud sandbox accepts (mirrors the
 * agent server's `remoteMcpServerSchema`: `--mcpServers` / ACP `McpServer`).
 * Included in the task-run creation payload for servers classified as
 * importable.
 */
export interface CloudMcpServerImport {
  type: "http" | "sse";
  name: string;
  url: string;
  headers: Array<{ name: string; value: string }>;
}

/**
 * A desktop-only local MCP server designated for relaying into a cloud run
 * (docs/cloud-mcp-relay.md). Names only — the sandbox never learns the
 * server's command, env, URL, or headers; the desktop resolves the name
 * against local config at execution time.
 */
export interface CloudMcpServerRelayDesignation {
  name: string;
}
