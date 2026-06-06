import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { NewSessionRequest } from "@agentclientprotocol/sdk";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "../../../utils/logger";

export function loadUserClaudeJsonMcpServers(
  cwd: string,
  logger?: Logger,
  homeDir: string = os.homedir(),
): Record<string, McpServerConfig> {
  const claudeJsonPath = path.join(homeDir, ".claude.json");

  let raw: string;
  try {
    raw = fs.readFileSync(claudeJsonPath, "utf8");
  } catch {
    return {};
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
    return {};
  }

  const topLevel =
    cfg.mcpServers && typeof cfg.mcpServers === "object"
      ? (cfg.mcpServers as Record<string, McpServerConfig>)
      : {};

  const project = cfg.projects?.[cwd];
  const projectScoped =
    project?.mcpServers && typeof project.mcpServers === "object"
      ? (project.mcpServers as Record<string, McpServerConfig>)
      : {};

  return { ...topLevel, ...projectScoped };
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
