/**
 * Tool bridge: converts MCP tools into pi tools and manages their lifecycle.
 *
 *   - Paginated tools/list (cursor loop per spec, with a max-page guard)
 *   - JSON Schema → TypeBox conversion (see ./schema.ts)
 *   - Tool name sanitization: `<prefix>_<server>_<tool>`, [a-zA-Z0-9_], ≤64 chars
 *   - Tool annotations surfaced as description hints
 *   - AbortSignal propagation → SDK sends notifications/cancelled
 *   - Register-once + activate/deactivate as servers connect/disconnect
 *   - Text/image passthrough; audio/resource content described as text
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  CallToolResultSchema,
  ListToolsResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpSettings } from "./config";
import { McpError } from "./errors";
import { renderMcpToolCall } from "./render";
import { convertJsonSchemaToTypebox } from "./schema";

/** Subset of pi's ExtensionAPI the bridge needs (narrow for easy faking). */
export type ToolBridgeHost = Pick<
  ExtensionAPI,
  "registerTool" | "getActiveTools" | "setActiveTools"
>;

const MAX_TOOL_NAME_LENGTH = 64;
const MAX_LIST_PAGES = 100;

/**
 * Build a pi-compatible tool name: `<prefix>_<server>_<tool>`.
 * Sanitized to [a-zA-Z0-9_]. Names longer than 64 chars are truncated with a
 * short hash suffix so distinct long names cannot collide after truncation.
 */
export function buildToolName(
  prefix: string,
  serverName: string,
  toolName: string,
): string {
  const raw = `${prefix}_${serverName}_${toolName}`;
  const safe = raw.replace(/[^a-zA-Z0-9_]/g, "_");
  if (safe.length <= MAX_TOOL_NAME_LENGTH) return safe;
  const hash = Math.abs(
    [...safe].reduce((acc, c) => ((acc << 5) - acc + c.charCodeAt(0)) | 0, 0),
  )
    .toString(36)
    .slice(0, 8);
  return `${safe.slice(0, MAX_TOOL_NAME_LENGTH - hash.length - 1)}_${hash}`;
}

type BridgedContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/** Convert MCP tool-result content blocks into pi tool-result content. */
export function convertMcpContent(items: unknown[]): BridgedContent[] {
  return items.map((raw): BridgedContent => {
    if (!raw || typeof raw !== "object") {
      return { type: "text", text: String(raw) };
    }
    const item = raw as Record<string, unknown>;
    switch (item.type) {
      case "text":
        return { type: "text", text: String(item.text ?? "") };
      case "image":
        if (
          typeof item.data === "string" &&
          typeof item.mimeType === "string"
        ) {
          return { type: "image", data: item.data, mimeType: item.mimeType };
        }
        return { type: "text", text: "[Image: invalid payload]" };
      case "audio":
        return {
          type: "text",
          text: `[Audio: ${String(item.mimeType ?? "unknown")}, base64 encoded]`,
        };
      case "resource": {
        const resource = item.resource as Record<string, unknown> | undefined;
        if (typeof resource?.text === "string") {
          return { type: "text", text: resource.text };
        }
        if (resource?.blob) {
          return {
            type: "text",
            text: `[Resource blob: ${String(resource.uri ?? "unknown")}]`,
          };
        }
        return {
          type: "text",
          text: `[Resource: ${String(resource?.uri ?? "unknown")}]`,
        };
      }
      default:
        return { type: "text", text: JSON.stringify(item) };
    }
  });
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    title?: string;
  };
}

/**
 * Fetch all tools from a server using cursor-based pagination. The MCP spec
 * mandates that clients follow `nextCursor` until exhausted; a max-page guard
 * protects against broken servers that loop forever.
 */
export async function listAllTools(
  client: Client,
  requestTimeoutMs: number,
): Promise<McpToolDefinition[]> {
  const tools: McpToolDefinition[] = [];
  let cursor: string | undefined;
  let pages = 0;

  do {
    if (pages >= MAX_LIST_PAGES) break;
    const result = await client.request(
      { method: "tools/list", params: cursor ? { cursor } : {} },
      ListToolsResultSchema,
      { timeout: requestTimeoutMs },
    );
    tools.push(...(result.tools as McpToolDefinition[]));
    cursor = result.nextCursor;
    pages++;
  } while (cursor);

  return tools;
}

function buildDescription(tool: McpToolDefinition): string {
  let description = tool.description ?? `MCP tool: ${tool.name}`;
  const ann = tool.annotations;
  if (ann) {
    const hints: string[] = [];
    if (ann.readOnlyHint) hints.push("read-only");
    if (ann.destructiveHint) hints.push("destructive");
    if (ann.idempotentHint) hints.push("idempotent");
    if (ann.openWorldHint) hints.push("interacts with external systems");
    if (hints.length > 0) description += ` [${hints.join(", ")}]`;
  }
  return description;
}

export interface ToolCollision {
  serverName: string;
  mcpToolName: string;
  piToolName: string;
}

/**
 * Manages MCP tools as pi tools for a set of servers. Tools are (re-)registered
 * on every refresh (pi's `registerTool` overwrites by name, and re-registering
 * rebinds the execute closure to the latest client after reconnects) and
 * activated/deactivated as servers connect/disconnect, avoiding tool churn.
 */
export class ToolBridge {
  private readonly settings: McpSettings;
  private readonly pi: ToolBridgeHost;
  /** pi tool names registered per MCP server. */
  private readonly serverToolNames = new Map<string, Set<string>>();
  /** Collisions observed during each server's most recent refresh. */
  private readonly serverCollisions = new Map<string, ToolCollision[]>();

  constructor(settings: McpSettings, pi: ToolBridgeHost) {
    this.settings = settings;
    this.pi = pi;
  }

  /** pi tool names currently tracked for a server. */
  getToolNames(serverName: string): string[] {
    return [...(this.serverToolNames.get(serverName) ?? [])];
  }

  /** Name collisions from the server's most recent refresh (for `/mcp <name>`). */
  getCollisions(serverName: string): ToolCollision[] {
    return [...(this.serverCollisions.get(serverName) ?? [])];
  }

  /**
   * Refresh tools for a server — called on initial connect and on
   * notifications/tools/list_changed. Deactivates tools that disappeared
   * from the server's list, then activates the current set.
   *
   * `requestTimeoutMs` overrides the global default (per-server config).
   */
  async refreshTools(
    serverName: string,
    client: Client,
    requestTimeoutMs?: number,
  ): Promise<void> {
    const timeoutMs = requestTimeoutMs ?? this.settings.requestTimeoutMs;

    let tools: McpToolDefinition[];
    try {
      tools = await listAllTools(client, timeoutMs);
    } catch (err) {
      throw new McpError(
        `Failed to list tools: ${err instanceof Error ? err.message : String(err)}`,
        serverName,
        "protocol",
        err,
      );
    }

    const previous = this.serverToolNames.get(serverName) ?? new Set<string>();
    const current = new Set<string>();
    // First MCP tool name to claim each pi name, so a collision report shows
    // both sides of the conflict, not just the tool that won the shadowing.
    const firstClaimant = new Map<string, string>();
    const reportedClaimant = new Set<string>();
    const collisions: ToolCollision[] = [];

    for (const tool of tools) {
      const piName = buildToolName(
        this.settings.toolPrefix,
        serverName,
        tool.name,
      );
      const claimant = firstClaimant.get(piName);
      if (claimant !== undefined) {
        // Two MCP tools sanitize to the same pi name (e.g. "a-b" vs "a_b").
        // The later definition wins; both names are recorded for /mcp
        // <name> diagnostics so the shadowed tool isn't invisible.
        if (!reportedClaimant.has(piName)) {
          reportedClaimant.add(piName);
          collisions.push({
            serverName,
            mcpToolName: claimant,
            piToolName: piName,
          });
        }
        collisions.push({
          serverName,
          mcpToolName: tool.name,
          piToolName: piName,
        });
      } else {
        firstClaimant.set(piName, tool.name);
      }
      current.add(piName);
      this.registerTool(piName, serverName, tool, client, timeoutMs);
    }

    for (const stale of previous) {
      if (!current.has(stale)) this.deactivateTool(stale);
    }

    this.serverToolNames.set(serverName, current);
    this.serverCollisions.set(serverName, collisions);
    this.activateServer(serverName);
  }

  /** Activate all pi tools belonging to a server. */
  activateServer(serverName: string): void {
    const names = this.serverToolNames.get(serverName);
    if (!names || names.size === 0) return;
    const active = new Set(this.pi.getActiveTools());
    for (const name of names) active.add(name);
    this.pi.setActiveTools([...active]);
  }

  /** Deactivate all pi tools belonging to a server (on disconnect). */
  deactivateServer(serverName: string): void {
    const names = this.serverToolNames.get(serverName);
    if (!names || names.size === 0) return;
    this.pi.setActiveTools(
      this.pi.getActiveTools().filter((name) => !names.has(name)),
    );
  }

  private deactivateTool(piName: string): void {
    this.pi.setActiveTools(
      this.pi.getActiveTools().filter((name) => name !== piName),
    );
  }

  private registerTool(
    piName: string,
    serverName: string,
    tool: McpToolDefinition,
    client: Client,
    timeoutMs: number,
  ): void {
    const description = buildDescription(tool);

    this.pi.registerTool({
      name: piName,
      label: tool.annotations?.title ?? tool.name,
      description,
      parameters: convertJsonSchemaToTypebox(tool.inputSchema),

      renderCall(args, theme, context) {
        return renderMcpToolCall(piName, args, theme, context.expanded);
      },

      async execute(_toolCallId, params, signal) {
        if (signal?.aborted) {
          return {
            content: [{ type: "text", text: "Cancelled" }],
            details: {},
          };
        }

        try {
          const result = await client.request(
            {
              method: "tools/call",
              params: { name: tool.name, arguments: params ?? {} },
            },
            CallToolResultSchema,
            // The SDK sends notifications/cancelled when the signal fires.
            { timeout: timeoutMs, ...(signal ? { signal } : {}) },
          );

          const content = convertMcpContent(result.content as unknown[]);

          // Tool execution errors (isError) are distinct from protocol errors.
          if (result.isError) {
            const text = content
              .map((c) => (c.type === "text" ? c.text : `[${c.type}]`))
              .join("\n");
            throw new McpError(
              text || "Tool reported an error",
              serverName,
              "tool",
            );
          }

          return { content, details: {} };
        } catch (err) {
          if (err instanceof McpError) throw err;
          throw new McpError(
            err instanceof Error ? err.message : String(err),
            serverName,
            "protocol",
            err,
          );
        }
      },
    });
  }
}
