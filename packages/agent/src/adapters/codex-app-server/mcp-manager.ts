/** An MCP tool call codex is running: its server, tool, and arguments. */
export interface McpCall {
  server: string;
  tool: string;
  args: unknown;
}

/**
 * Manages the session's MCP tool-call state.
 *
 * Its main job today is correlating codex approval prompts back to the tool that
 * triggered them. Codex has no MCP-specific approval: a tool surfaces either a
 * command-execution approval (which carries the item id) or — for the PostHog
 * `exec` tool — a generic `mcpServer/elicitation/request` carrying only the
 * server name. Neither carries the real tool/args, so we remember each in-flight
 * call from its `mcpToolCall` item and recover it at approval time: by item id
 * for a command approval, or by server name for an elicitation (which has no id,
 * so it correlates to the latest in-flight call for that server — MCP calls are
 * sequential and an elicitation fires while its call is live). Session-scoped and
 * small (one entry per MCP call).
 */
export class McpManager {
  private readonly byId = new Map<string, McpCall>();
  private latest?: McpCall;

  /** Record an `mcpToolCall` item from an item/started or item/completed notification. */
  capture(params: unknown): void {
    const item = (
      params as {
        item?: {
          type?: string;
          id?: string;
          server?: string;
          tool?: string;
          arguments?: unknown;
        };
      }
    )?.item;
    if (item?.type === "mcpToolCall" && item.id && item.server && item.tool) {
      const call: McpCall = {
        server: item.server,
        tool: item.tool,
        args: item.arguments,
      };
      this.byId.set(item.id, call);
      this.latest = call;
    }
  }

  /** The MCP call for a command-execution approval's item id, if known. */
  byItemId(itemId: string | undefined): McpCall | undefined {
    return itemId ? this.byId.get(itemId) : undefined;
  }

  /** The in-flight MCP call for an elicitation's server (elicitations carry no item id). */
  byServer(serverName: string): McpCall | undefined {
    return this.latest?.server === serverName ? this.latest : undefined;
  }
}
