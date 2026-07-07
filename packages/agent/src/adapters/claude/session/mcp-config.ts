import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { NewSessionRequest } from "@agentclientprotocol/sdk";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "../../../utils/logger";

export type ClaudeJsonMcpScope = "user" | "project";

export interface ClaudeJsonMcpServerEntry {
  name: string;
  scope: ClaudeJsonMcpScope;
  config: McpServerConfig;
}

/**
 * Reads the user's MCP servers from ~/.claude.json: the top-level `mcpServers`
 * section plus, when `cwd` is given, the `projects[cwd].mcpServers` section. A
 * project-scoped server replaces a user-scoped one with the same name,
 * matching how Claude Code merges the two sections.
 */
export function loadUserClaudeJsonMcpServerEntries(
  cwd?: string,
  logger?: Logger,
  homeDir: string = os.homedir(),
): ClaudeJsonMcpServerEntry[] {
  const claudeJsonPath = path.join(homeDir, ".claude.json");

  let raw: string;
  try {
    raw = fs.readFileSync(claudeJsonPath, "utf8");
  } catch {
    return [];
  }

  let cfg: {
    mcpServers?: unknown;
    projects?: Record<string, { mcpServers?: unknown }>;
  };
  try {
    cfg = JSON.parse(raw);
  } catch (err) {
    logger?.warn("Failed to parse ~/.claude.json", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const sections: Array<{ scope: ClaudeJsonMcpScope; servers: unknown }> = [
    { scope: "user", servers: cfg.mcpServers },
    {
      scope: "project",
      servers: cwd ? cfg.projects?.[cwd]?.mcpServers : undefined,
    },
  ];

  const byName = new Map<string, ClaudeJsonMcpServerEntry>();
  for (const { scope, servers } of sections) {
    if (!servers || typeof servers !== "object") continue;
    for (const [name, config] of Object.entries(
      servers as Record<string, McpServerConfig>,
    )) {
      byName.set(name, { name, scope, config });
    }
  }
  return [...byName.values()];
}

export function loadUserClaudeJsonMcpServers(
  cwd: string,
  logger?: Logger,
  homeDir: string = os.homedir(),
): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = {};
  for (const entry of loadUserClaudeJsonMcpServerEntries(
    cwd,
    logger,
    homeDir,
  )) {
    servers[entry.name] = entry.config;
  }
  return servers;
}

export function parseMcpServers(
  params: Pick<NewSessionRequest, "mcpServers">,
  logger?: Logger,
): Record<string, McpServerConfig> {
  const mcpServers: Record<string, McpServerConfig> = {};
  if (!Array.isArray(params.mcpServers)) {
    return mcpServers;
  }

  for (const server of params.mcpServers) {
    if ("type" in server) {
      if (server.type === "http" || server.type === "sse") {
        mcpServers[server.name] = {
          type: server.type,
          url: server.url,
          headers: server.headers
            ? Object.fromEntries(
                server.headers.map((e: { name: string; value: string }) => [
                  e.name,
                  e.value,
                ]),
              )
            : undefined,
        };
      } else {
        // ACP 0.22 introduced the `sdk` McpServerConfig variant; the SDK
        // adapter doesn't construct in-process servers, so surface a warning
        // rather than silently dropping the entry.
        logger?.warn("parseMcpServers: dropping unsupported MCP server type", {
          name: server.name,
          type: (server as { type: string }).type,
        });
      }
    } else {
      mcpServers[server.name] = {
        type: "stdio",
        command: server.command,
        args: server.args,
        env: server.env
          ? Object.fromEntries(server.env.map((e) => [e.name, e.value]))
          : undefined,
      };
    }
  }

  return mcpServers;
}
