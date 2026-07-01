import type { McpServer } from "@agentclientprotocol/sdk";

/**
 * Codex's per-thread `mcp_servers` config entry (stdio: command/args/env; http:
 * url + headers), accepted under `thread/start`'s `config.mcp_servers`.
 */
export type CodexMcpServerConfig =
  | { command: string; args: string[]; env?: Record<string, string> }
  | { url: string; http_headers?: Record<string, string> };

/**
 * Translates the ACP `McpServer[]` into the shape Codex's app-server expects under
 * `config.mcp_servers` — ACP encodes env/headers as `{ name, value }[]`, Codex
 * wants plain string maps. Returns undefined when there's nothing to inject.
 */
export function toCodexMcpServers(
  servers: McpServer[] | undefined,
): Record<string, CodexMcpServerConfig> | undefined {
  if (!servers || servers.length === 0) {
    return undefined;
  }

  const out: Record<string, CodexMcpServerConfig> = {};
  for (const server of servers) {
    if ("command" in server && server.command) {
      const env = pairsToRecord(server.env);
      out[server.name] = {
        command: server.command,
        args: server.args ?? [],
        ...(env ? { env } : {}),
      };
    } else if ("url" in server && server.url) {
      const headers = pairsToRecord(server.headers);
      out[server.name] = {
        url: server.url,
        ...(headers ? { http_headers: headers } : {}),
      };
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function pairsToRecord(
  pairs: Array<{ name: string; value: string }> | undefined,
): Record<string, string> | undefined {
  if (!pairs || pairs.length === 0) {
    return undefined;
  }
  const record: Record<string, string> = {};
  for (const { name, value } of pairs) {
    record[name] = value;
  }
  return record;
}
