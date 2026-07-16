import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { loadUserClaudeJsonMcpServerEntries } from "@posthog/agent/adapters/claude/session/mcp-config";
import type {
  LocalMcpServerDescriptor,
  LocalMcpTransport,
} from "@posthog/shared";
import { injectable } from "inversify";
import type { LocalMcpService } from "./identifiers";

function sanitizeHeaders(headers: unknown): Record<string, string> | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const entries = Object.entries(headers as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function toTransport(config: McpServerConfig): LocalMcpTransport {
  // ~/.claude.json is hand-editable, so treat the parsed config as untyped.
  const raw = config as Record<string, unknown>;
  const type = typeof raw.type === "string" ? raw.type : undefined;

  if ((type === "http" || type === "sse") && typeof raw.url === "string") {
    return { type, url: raw.url, headers: sanitizeHeaders(raw.headers) };
  }
  if (
    (type === undefined || type === "stdio") &&
    typeof raw.command === "string"
  ) {
    const args = Array.isArray(raw.args)
      ? raw.args.filter((arg): arg is string => typeof arg === "string")
      : undefined;
    return { type: "stdio", command: raw.command, args };
  }
  // Legacy entries can carry a bare `url` with no `type`; streamable HTTP is
  // the current default transport, so read them as http.
  if (type === undefined && typeof raw.url === "string") {
    return {
      type: "http",
      url: raw.url,
      headers: sanitizeHeaders(raw.headers),
    };
  }
  return { type: "unknown" };
}

@injectable()
export class LocalMcpServiceImpl implements LocalMcpService {
  async listServers(cwd?: string): Promise<LocalMcpServerDescriptor[]> {
    return loadUserClaudeJsonMcpServerEntries(cwd).map((entry) => ({
      name: entry.name,
      scope: entry.scope,
      transport: toTransport(entry.config),
    }));
  }
}
