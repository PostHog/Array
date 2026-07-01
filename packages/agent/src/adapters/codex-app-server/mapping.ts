import type {
  SessionNotification,
  ToolCallContent,
  ToolCallLocation,
} from "@agentclientprotocol/sdk";
import { mcpToolKey, posthogToolMeta } from "@posthog/shared";
import { APP_SERVER_NOTIFICATIONS } from "./protocol";

/**
 * Translates a native app-server notification into an ACP SessionNotification
 * so the rest of PostHog Code, which speaks ACP, stays unchanged.
 *
 * Streamed text (agent message + reasoning) maps to chunks; item lifecycle
 * notifications for tool-like items (command execution, file changes, MCP tool
 * calls, web search) map to `tool_call` / `tool_call_update`. Agent-message and
 * reasoning *items* are intentionally dropped here because their deltas already
 * streamed the content — re-emitting the completed item would double-render.
 * Structured-output capture is handled in the agent, not here.
 */
export function mapAppServerNotification(
  sessionId: string,
  method: string,
  params: unknown,
): SessionNotification | null {
  switch (method) {
    case APP_SERVER_NOTIFICATIONS.AGENT_MESSAGE_DELTA: {
      const delta = readStringField(params, "delta");
      if (!delta) return null;
      return {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: delta },
        },
      };
    }
    // Both reasoning streams (raw textDelta + the default summaryTextDelta) carry
    // a `delta: string` and map to the same ACP thought chunk.
    case APP_SERVER_NOTIFICATIONS.REASONING_TEXT_DELTA:
    case APP_SERVER_NOTIFICATIONS.REASONING_SUMMARY_TEXT_DELTA: {
      const delta = readStringField(params, "delta");
      if (!delta) return null;
      return {
        sessionId,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: delta },
        },
      };
    }
    case APP_SERVER_NOTIFICATIONS.TOKEN_USAGE_UPDATED: {
      // Context/token indicator: the renderer reads `used`/`size` off the
      // update (same shape codex-acp forwards). Detailed token breakdown is
      // additionally emitted as a `_posthog/usage_update` ext-notification by
      // the agent.
      const tu = (params as { tokenUsage?: any })?.tokenUsage;
      // Occupancy is THIS turn's `last` (mirroring usage-tracker.ts), not codex's
      // cumulative `total` — `total` grows across the whole thread, so feeding it
      // to the gauge over-reports and pegs it at 100% after enough turns. `total`
      // is only the fallback for a build that predates `last` (≈ total on turn 1).
      const context = tu?.last ?? tu?.total;
      const used = context?.totalTokens ?? context?.inputTokens;
      if (used == null) return null;
      const size = tu?.modelContextWindow;
      // `usage_update` is a PostHog-convention update, not in the ACP union.
      return {
        sessionId,
        update: {
          sessionUpdate: "usage_update",
          used,
          ...(size != null ? { size } : {}),
        },
      } as unknown as SessionNotification;
    }
    case APP_SERVER_NOTIFICATIONS.TURN_PLAN_UPDATED: {
      const plan = (
        params as { plan?: Array<{ step?: string; status?: string }> }
      )?.plan;
      if (!Array.isArray(plan)) return null;
      return {
        sessionId,
        update: {
          sessionUpdate: "plan",
          entries: plan.map((s) => ({
            content: s.step ?? "",
            priority: "medium",
            status: mapPlanStatus(s.status),
          })),
        },
      } as unknown as SessionNotification;
    }
    case APP_SERVER_NOTIFICATIONS.ITEM_STARTED:
    case APP_SERVER_NOTIFICATIONS.ITEM_COMPLETED: {
      const item = readItem(params);
      if (!item) return null;
      return mapItem(
        sessionId,
        item,
        method === APP_SERVER_NOTIFICATIONS.ITEM_COMPLETED,
      );
    }
    case APP_SERVER_NOTIFICATIONS.COMMAND_OUTPUT_DELTA: {
      // Live stdout/stderr for an in-progress command: surface as streamed text
      // on the tool call so output appears before the item completes. The host
      // renderer accumulates these chunks the same way the Claude adapter does
      // for its terminal output.
      const itemId = readStringField(params, "itemId");
      const delta = readStringField(params, "delta");
      if (!itemId || !delta) return null;
      return toolOutputChunk(sessionId, itemId, delta);
    }
    case APP_SERVER_NOTIFICATIONS.TERMINAL_INTERACTION: {
      // PTY stdin echoed back for an interactive command. Echo it into the same
      // tool call so the transcript shows what was typed, mirroring how a real
      // terminal renders local echo.
      const itemId = readStringField(params, "itemId");
      const stdin = readStringField(params, "stdin");
      if (!itemId || !stdin) return null;
      return toolOutputChunk(sessionId, itemId, stdin);
    }
    case APP_SERVER_NOTIFICATIONS.FILE_CHANGE_PATCH_UPDATED: {
      // Incremental diff for an in-progress fileChange: push the latest diff so
      // the edit renders before the patch is applied.
      const itemId = readStringField(params, "itemId");
      if (!itemId) return null;
      const changes = (params as { changes?: AppServerItem["changes"] })
        ?.changes;
      const content = diffContent(changes);
      if (!content) return null;
      return {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: itemId,
          status: "in_progress",
          content,
        },
      };
    }
    default:
      return null;
  }
}

/**
 * A streamed text chunk attached to an in-progress tool call. ACP's
 * `tool_call_update.content` semantically replaces the collection; the host
 * renderer treats successive single-chunk updates as appended output, which is
 * how live command output streams without owning an ACP terminal lifecycle.
 */
function toolOutputChunk(
  sessionId: string,
  toolCallId: string,
  text: string,
): SessionNotification {
  return {
    sessionId,
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId,
      status: "in_progress",
      content: [{ type: "content", content: { type: "text", text } }],
    },
  };
}

function mapPlanStatus(
  status: string | undefined,
): "pending" | "in_progress" | "completed" {
  if (status === "inProgress") return "in_progress";
  if (status === "completed") return "completed";
  return "pending";
}

/**
 * Extracts {oldText,newText} from a unified diff so a codex `fileChange` renders
 * as an ACP diff. Hunk-level (context + ± lines), which is what the renderer
 * needs to show the change. Known cosmetic limit: a content line whose payload
 * begins with "-- " / "++ " (diff line "--- " / "+++ ") is misread as a file
 * header and dropped from the rendered diff — it never affects the actual edit.
 */
export function parseUnifiedDiff(diff: string): {
  oldText: string;
  newText: string;
} {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const line of diff.split("\n")) {
    // Skip diff/hunk metadata. The file headers are "--- a/..." / "+++ b/..."
    // and the no-newline marker is "\ No newline...". Match the trailing space
    // on --- / +++ so a real added/removed CONTENT line like "++i;" (diff line
    // "+++i;") or "--count" isn't mistaken for a header and dropped.
    if (
      line.startsWith("@@") ||
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("\\ ")
    ) {
      continue;
    }
    if (line.startsWith("-")) oldLines.push(line.slice(1));
    else if (line.startsWith("+")) newLines.push(line.slice(1));
    else {
      const ctx = line.startsWith(" ") ? line.slice(1) : line;
      oldLines.push(ctx);
      newLines.push(ctx);
    }
  }
  return { oldText: oldLines.join("\n"), newText: newLines.join("\n") };
}

export type AppServerItem = {
  type?: string;
  id?: string;
  command?: string;
  cwd?: string;
  commandActions?: Array<{ type?: string; path?: string } | string>;
  server?: string;
  tool?: string;
  namespace?: string | null;
  contentItems?: unknown;
  query?: string;
  status?: string;
  arguments?: unknown;
  aggregatedOutput?: string | null;
  changes?: Array<{ path?: string; diff?: string; kind?: unknown }>;
  // mcpToolCall result / error (McpToolCallResult / McpToolCallError).
  result?: { content?: unknown } | null;
  error?: { message?: string } | null;
  // Present on message/reasoning items replayed from thread history.
  text?: string;
  content?: unknown;
};

/** Text rendering of a completed mcpToolCall: the error message, else the
 * result's text content blocks joined. */
function mcpResultText(
  result: AppServerItem["result"],
  error: AppServerItem["error"],
): string | null {
  if (error?.message) return error.message;
  const content = result?.content;
  if (!Array.isArray(content)) return null;
  const text = content
    .filter(
      (c) =>
        c && typeof c === "object" && (c as { type?: string }).type === "text",
    )
    .map((c) => (c as { text?: string }).text ?? "")
    .filter(Boolean)
    .join("\n");
  return text || null;
}

/** Text rendering of a dynamicToolCall's output (its `inputText` content items). */
function dynamicToolText(items: unknown): string | null {
  if (!Array.isArray(items)) return null;
  const text = items
    .filter(
      (c) =>
        c &&
        typeof c === "object" &&
        (c as { type?: string }).type === "inputText",
    )
    .map((c) => (c as { text?: string }).text ?? "")
    .filter(Boolean)
    .join("\n");
  return text || null;
}

/**
 * Re-renders a persisted `ThreadItem` (from `thread/resume`'s `thread.turns`) as
 * the ACP updates a live stream would have produced, so a reattaching host shows
 * the full transcript. A tool item collapses to a single completed `tool_call`
 * (there is no prior start to update); messages map to their chunk. Reuses the
 * live `describeTool`/`completedContent`/`mapStatus` so there is no second
 * rendering surface to drift. Ephemeral items (reasoning, plan, hookPrompt) are
 * not replayed.
 */
export function mapHistoryItem(
  sessionId: string,
  item: AppServerItem,
): SessionNotification[] {
  switch (item.type) {
    case "userMessage":
      return userMessageChunks(sessionId, item.content);
    case "agentMessage":
      return item.text
        ? [
            {
              sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: item.text },
              },
            },
          ]
        : [];
    case "reasoning":
    case "plan":
      return [];
    default: {
      const tool = describeTool(item);
      if (!tool || !item.id) return [];
      const content = completedContent(item, tool);
      return [
        {
          sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: item.id,
            title: tool.title,
            kind: tool.kind,
            status: mapStatus(item.status),
            ...(tool.rawInput !== undefined ? { rawInput: tool.rawInput } : {}),
            ...(tool.locations?.length ? { locations: tool.locations } : {}),
            ...(tool.mcp
              ? {
                  _meta: posthogToolMeta({
                    toolName: mcpToolKey(tool.mcp),
                    mcp: tool.mcp,
                  }),
                }
              : {}),
            ...(content ? { content } : {}),
          },
        },
      ];
    }
  }
}

/**
 * A persisted `userMessage`'s `content` is codex `UserInput[]`. Replay the text
 * inputs as `user_message_chunk`s; historical image attachments aren't
 * re-rendered (the live echo handles new ones), keeping the replay lossless for
 * the text transcript without reconstructing data URLs here.
 */
function userMessageChunks(
  sessionId: string,
  content: unknown,
): SessionNotification[] {
  if (!Array.isArray(content)) return [];
  const out: SessionNotification[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: string }).type === "text"
    ) {
      const text = (block as { text?: string }).text;
      if (typeof text === "string" && text) {
        out.push({
          sessionId,
          update: {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text },
          },
        });
      }
    }
  }
  return out;
}

type ToolDescriptor = {
  title: string;
  kind: "execute" | "edit" | "fetch" | "other" | "read" | "search";
  rawInput?: unknown;
  output?: string | null;
  locations?: ToolCallLocation[];
  /**
   * Originating MCP server + tool for MCP tool calls. Surfaced on the canonical
   * `_meta.posthog` channel so the host renderer routes MCP rendering (and the
   * PostHog `exec` display) the same way it does for every adapter.
   */
  mcp?: { server: string; tool: string };
};

/**
 * Classify a shell command by its parsed actions so read-only commands (`cat`,
 * `ls`, `grep`) render as read/search rather than execute — matching how the
 * codex-acp adapter surfaces them.
 */
function commandKind(
  actions: AppServerItem["commandActions"],
): "read" | "search" | "execute" {
  if (!actions?.length) return "execute";
  const types = actions.map((a) => (typeof a === "string" ? a : a?.type));
  if (types.every((t) => t === "read")) return "read";
  if (types.every((t) => t === "search" || t === "listFiles")) return "search";
  return "execute";
}

function describeTool(item: AppServerItem): ToolDescriptor | null {
  switch (item.type) {
    case "commandExecution":
      return {
        title: item.command ?? "Run command",
        kind: commandKind(item.commandActions),
        output: item.aggregatedOutput ?? null,
        locations: commandLocations(item),
      };
    case "fileChange": {
      const paths = changePaths(item.changes);
      return {
        // Title with the changed path(s) instead of a generic label so the
        // tool call reads like Claude's edit summary.
        title: fileChangeTitle(paths),
        kind: "edit",
        locations: paths.map((path) => ({ path })),
      };
    }
    case "mcpToolCall":
      return {
        title: `${item.server ?? "mcp"}/${item.tool ?? "tool"}`,
        kind: "other",
        rawInput: item.arguments,
        output: mcpResultText(item.result, item.error),
        mcp: { server: item.server ?? "mcp", tool: item.tool ?? "tool" },
      };
    case "dynamicToolCall":
      return {
        title: item.namespace
          ? `${item.namespace}/${item.tool ?? "tool"}`
          : (item.tool ?? "tool"),
        kind: "other",
        rawInput: item.arguments,
        output: dynamicToolText(item.contentItems),
      };
    case "webSearch":
      return { title: item.query ?? "Web search", kind: "fetch" };
    default:
      return null;
  }
}

/** Distinct, non-empty changed paths for a fileChange item, order-preserved. */
export function changePaths(changes: AppServerItem["changes"]): string[] {
  if (!changes?.length) return [];
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const change of changes) {
    const path = change?.path;
    if (path && !seen.has(path)) {
      seen.add(path);
      paths.push(path);
    }
  }
  return paths;
}

function fileChangeTitle(paths: string[]): string {
  if (!paths.length) return "Edit files";
  if (paths.length === 1) return paths[0];
  return `${paths[0]} (+${paths.length - 1} more)`;
}

/**
 * Clickable locations for a commandExecution: the read/search/listFiles command
 * actions carry concrete paths, otherwise fall back to the working directory so
 * the UI can still anchor "follow-along" navigation somewhere.
 */
function commandLocations(item: AppServerItem): ToolCallLocation[] | undefined {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const action of item.commandActions ?? []) {
    const path = typeof action === "string" ? undefined : action?.path;
    if (path && !seen.has(path)) {
      seen.add(path);
      paths.push(path);
    }
  }
  if (!paths.length && item.cwd) paths.push(item.cwd);
  if (!paths.length) return undefined;
  return paths.map((path) => ({ path }));
}

function mapItem(
  sessionId: string,
  item: AppServerItem,
  completed: boolean,
): SessionNotification | null {
  const tool = describeTool(item);
  if (!tool || !item.id) {
    return null;
  }

  if (!completed) {
    return {
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: item.id,
        title: tool.title,
        kind: tool.kind,
        status: "in_progress",
        ...(tool.rawInput !== undefined ? { rawInput: tool.rawInput } : {}),
        ...(tool.locations?.length ? { locations: tool.locations } : {}),
        ...(tool.mcp
          ? {
              _meta: posthogToolMeta({
                toolName: mcpToolKey(tool.mcp),
                mcp: tool.mcp,
              }),
            }
          : {}),
      },
    };
  }

  const content = completedContent(item, tool);
  return {
    sessionId,
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: item.id,
      status: mapStatus(item.status),
      ...(content ? { content } : {}),
    },
  };
}

/** Content for a completed tool call: file diffs for fileChange, else output text. */
function completedContent(
  item: AppServerItem,
  tool: ToolDescriptor,
): ToolCallContent[] | undefined {
  if (item.type === "fileChange") {
    const diffs = diffContent(item.changes);
    if (diffs) return diffs;
  }
  if (tool.output) {
    return [{ type: "content", content: { type: "text", text: tool.output } }];
  }
  return undefined;
}

/** Maps a fileChange's `changes[]` to ACP `diff` content blocks. */
export function diffContent(
  changes: AppServerItem["changes"],
): ToolCallContent[] | undefined {
  if (!changes?.length) return undefined;
  const diffs = changes
    .filter((c) => c?.diff)
    .map(
      (c) =>
        ({
          type: "diff",
          path: c.path,
          ...parseUnifiedDiff(c.diff ?? ""),
        }) as unknown as ToolCallContent,
    );
  return diffs.length ? diffs : undefined;
}

function mapStatus(
  status: string | undefined,
): "completed" | "failed" | "in_progress" {
  if (status === "completed") return "completed";
  if (status === "failed" || status === "declined") return "failed";
  return "in_progress";
}

function readItem(params: unknown): AppServerItem | null {
  if (params && typeof params === "object" && "item" in params) {
    const item = (params as Record<string, unknown>).item;
    if (item && typeof item === "object") {
      return item as AppServerItem;
    }
  }
  return null;
}

function readStringField(params: unknown, key: string): string | null {
  if (params && typeof params === "object" && key in params) {
    const value = (params as Record<string, unknown>)[key];
    return typeof value === "string" ? value : null;
  }
  return null;
}
