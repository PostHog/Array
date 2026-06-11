import type {
  AgentSideConnection,
  Role,
  SessionNotification,
  SessionUpdate,
} from "@agentclientprotocol/sdk";
import { RequestError, type StopReason } from "@agentclientprotocol/sdk";
import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  TaskCreateInput,
  TaskUpdateInput,
} from "@anthropic-ai/claude-agent-sdk/sdk-tools.js";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources";
import type {
  BetaContentBlock,
  BetaRawContentBlockDelta,
} from "@anthropic-ai/sdk/resources/beta.mjs";
import { POSTHOG_NOTIFICATIONS } from "@/acp-extensions";
import { image, text } from "../../../utils/acp-content";
import { unreachable } from "../../../utils/common";
import type { Logger } from "../../../utils/logger";
import { tryParsePartialJson } from "../../../utils/partial-json";
import { classifyAgentError } from "../../error-classification";
import { type EnrichedReadCache, registerHookCallback } from "../hooks";
import type {
  Session,
  ToolUpdateMeta,
  ToolUseCache,
  ToolUseStreamCache,
} from "../types";
import {
  applyTaskCreate,
  applyTaskUpdate,
  parseTaskCreateOutput,
  type TaskState,
  taskStateToPlanEntries,
} from "./task-state";
import {
  toolInfoFromToolUse,
  toolUpdateFromEditToolResponse,
  toolUpdateFromToolResult,
} from "./tool-use-to-acp";

type AnthropicContentChunk =
  | ContentBlockParam
  | BetaContentBlock
  | BetaRawContentBlockDelta;

type AnthropicMessageContent = string | Array<{ type: string; text?: string }>;

interface AnthropicMessageWithContent {
  type: Role;
  message: {
    content: AnthropicMessageContent;
    model?: string;
  };
}

type ChunkHandlerContext = {
  sessionId: string;
  toolUseCache: ToolUseCache;
  fileContentCache: { [key: string]: string };
  enrichedReadCache?: EnrichedReadCache;
  client: AgentSideConnection;
  logger: Logger;
  parentToolCallId?: string;
  registerHooks?: boolean;
  supportsTerminalOutput?: boolean;
  cwd?: string;
  /** Raw MCP tool result from SDKUserMessage.tool_use_result (contains content, structuredContent, _meta) */
  mcpToolUseResult?: Record<string, unknown>;
  /** Per-session task list (populated by createTaskHook + tool_result handler) */
  taskState?: TaskState;
};

/**
 * Per-turn record of which top-level assistant message ids actually streamed
 * text/thinking live via `stream_event` deltas. The consolidated assistant
 * message normally has its text/thinking blocks dropped as duplicates of the
 * streamed chunks, but gateways that return a turn as a single non-streamed
 * block (common with OpenAI-compatible proxies) never fire deltas, so the
 * assembled block is the only copy the client will ever see. Tracked per
 * block type so a gateway that streams text but not thinking (or vice versa)
 * doesn't lose the un-streamed block.
 */
export interface StreamedAssistantBlocks {
  currentStreamMessageId?: string;
  textIds: Set<string>;
  thinkingIds: Set<string>;
}

export interface MessageHandlerContext {
  session: Session;
  sessionId: string;
  client: AgentSideConnection;
  toolUseCache: ToolUseCache;
  /** Buffers `input_json_delta` partial JSON per content-block index. */
  toolUseStreamCache: ToolUseStreamCache;
  fileContentCache: { [key: string]: string };
  enrichedReadCache?: EnrichedReadCache;
  logger: Logger;
  registerHooks?: boolean;
  supportsTerminalOutput?: boolean;
  /** Absent on replay, where the legacy drop-all text/thinking filter applies. */
  streamedAssistantBlocks?: StreamedAssistantBlocks;
}

function messageUpdateType(role: Role) {
  return role === "assistant" ? "agent_message_chunk" : "user_message_chunk";
}

function toolMeta(
  toolName: string,
  toolResponse?: unknown,
  parentToolCallId?: string,
  bashCommand?: string,
): ToolUpdateMeta {
  const meta: ToolUpdateMeta["claudeCode"] = { toolName };
  if (toolResponse !== undefined) meta.toolResponse = toolResponse;
  if (parentToolCallId) meta.parentToolCallId = parentToolCallId;
  if (bashCommand) meta.bashCommand = bashCommand;
  return { claudeCode: meta };
}

function bashCommandFromToolUse(
  toolUse: ToolUseCache[string] | undefined,
): string | undefined {
  if (!toolUse || toolUse.name !== "Bash") return undefined;
  const command = (toolUse.input as { command?: unknown } | undefined)?.command;
  return typeof command === "string" ? command : undefined;
}

function handleTextChunk(
  chunk: { text: string },
  role: Role,
  parentToolCallId?: string,
): SessionUpdate {
  const update: SessionUpdate = {
    sessionUpdate: messageUpdateType(role),
    content: text(chunk.text),
  };
  if (parentToolCallId) {
    (update as Record<string, unknown>)._meta = toolMeta(
      "__text__",
      undefined,
      parentToolCallId,
    );
  }
  return update;
}

function handleImageChunk(
  chunk: {
    source: { type: string; data?: string; media_type?: string; url?: string };
  },
  role: Role,
): SessionUpdate {
  return {
    sessionUpdate: messageUpdateType(role),
    content: image(
      chunk.source.type === "base64" ? (chunk.source.data ?? "") : "",
      chunk.source.type === "base64" ? (chunk.source.media_type ?? "") : "",
      chunk.source.type === "url" ? chunk.source.url : undefined,
    ),
  };
}

function handleThinkingChunk(
  chunk: { thinking: string },
  parentToolCallId?: string,
): SessionUpdate {
  const update: SessionUpdate = {
    sessionUpdate: "agent_thought_chunk",
    content: text(chunk.thinking),
  };
  if (parentToolCallId) {
    (update as Record<string, unknown>)._meta = toolMeta(
      "__thinking__",
      undefined,
      parentToolCallId,
    );
  }
  return update;
}

function handleToolUseChunk(
  chunk: ToolUseCache[string],
  ctx: ChunkHandlerContext,
): SessionUpdate | null {
  const alreadyCached = chunk.id in ctx.toolUseCache;
  ctx.toolUseCache[chunk.id] = chunk;

  // Suppress Task* tool_calls — plan updates are emitted from the matching
  // tool_result handler instead, after taskState has been mutated.
  if (
    chunk.name === "TaskCreate" ||
    chunk.name === "TaskUpdate" ||
    chunk.name === "TaskList" ||
    chunk.name === "TaskGet"
  ) {
    return null;
  }

  if (!alreadyCached && ctx.registerHooks !== false) {
    const toolName = chunk.name;
    const bashCommand = bashCommandFromToolUse(chunk);
    registerHookCallback(chunk.id, {
      onPostToolUseHook: async (toolUseId, _toolInput, toolResponse) => {
        const editUpdate =
          toolName === "Edit" || toolName === "Write"
            ? toolUpdateFromEditToolResponse(toolResponse)
            : null;

        await ctx.client.sessionUpdate({
          sessionId: ctx.sessionId,
          update: {
            _meta: toolMeta(
              toolName,
              toolResponse,
              ctx.parentToolCallId,
              bashCommand,
            ),
            toolCallId: toolUseId,
            sessionUpdate: "tool_call_update",
            ...(editUpdate ? editUpdate : {}),
          },
        });
      },
    });
  }

  let rawInput: Record<string, unknown> | undefined;
  try {
    rawInput = JSON.parse(JSON.stringify(chunk.input));
  } catch {
    // ignore
  }

  const toolInfo = toolInfoFromToolUse(chunk, {
    supportsTerminalOutput: ctx.supportsTerminalOutput,
    toolUseId: chunk.id,
    cachedFileContent: ctx.fileContentCache,
    cwd: ctx.cwd,
  });

  const meta: Record<string, unknown> = {
    ...toolMeta(
      chunk.name,
      undefined,
      ctx.parentToolCallId,
      bashCommandFromToolUse(chunk),
    ),
  };
  if (chunk.name === "Bash" && ctx.supportsTerminalOutput && !alreadyCached) {
    meta.terminal_info = { terminal_id: chunk.id };
  }

  if (alreadyCached) {
    return {
      _meta: meta,
      toolCallId: chunk.id,
      sessionUpdate: "tool_call_update" as const,
      rawInput,
      ...toolInfo,
    };
  }

  return {
    _meta: meta,
    toolCallId: chunk.id,
    sessionUpdate: "tool_call" as const,
    rawInput,
    status: "pending",
    ...toolInfo,
  };
}

function extractTextFromContent(content: unknown): string | null {
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (
        typeof item === "object" &&
        item !== null &&
        "text" in item &&
        typeof (item as Record<string, unknown>).text === "string"
      ) {
        parts.push((item as { text: string }).text);
      }
    }
    return parts.length > 0 ? parts.join("") : null;
  }
  if (typeof content === "string") {
    return content;
  }
  return null;
}

export function stripCatLineNumbers(text: string): string {
  return text.replace(/^ *\d+[\t→]/gm, "");
}

function updateFileContentCache(
  toolUse: { name: string; input: unknown },
  chunk: { content?: unknown },
  ctx: ChunkHandlerContext,
): void {
  const input = toolUse.input as Record<string, unknown> | undefined;
  const filePath = input?.file_path ? String(input.file_path) : undefined;
  if (!filePath) return;

  if (toolUse.name === "Read" && !input?.limit && !input?.offset) {
    const fileText = extractTextFromContent(chunk.content);
    if (fileText !== null) {
      ctx.fileContentCache[filePath] = stripCatLineNumbers(fileText);
    }
  } else if (toolUse.name === "Write") {
    const content = input?.content;
    if (typeof content === "string") {
      ctx.fileContentCache[filePath] = content;
    }
  } else if (toolUse.name === "Edit") {
    const oldString = input?.old_string;
    const newString = input?.new_string;
    if (
      typeof oldString === "string" &&
      typeof newString === "string" &&
      filePath in ctx.fileContentCache
    ) {
      const current = ctx.fileContentCache[filePath];
      ctx.fileContentCache[filePath] = input?.replace_all
        ? current.replaceAll(oldString, newString)
        : current.replace(oldString, newString);
    }
  }
}

function handleToolResultChunk(
  chunk: AnthropicContentChunk & {
    tool_use_id: string;
    is_error?: boolean;
    content?: unknown;
  },
  ctx: ChunkHandlerContext,
): SessionUpdate[] {
  const toolUse = ctx.toolUseCache[chunk.tool_use_id];
  if (!toolUse) {
    ctx.logger.error(
      `Got a tool result for tool use that wasn't tracked: ${chunk.tool_use_id}`,
    );
    return [];
  }

  delete ctx.toolUseCache[chunk.tool_use_id];

  if (
    toolUse.name === "TaskCreate" ||
    toolUse.name === "TaskUpdate" ||
    toolUse.name === "TaskList" ||
    toolUse.name === "TaskGet"
  ) {
    if (chunk.is_error || !ctx.taskState) return [];
    if (toolUse.name === "TaskCreate") {
      applyTaskCreate(
        ctx.taskState,
        toolUse.input as TaskCreateInput | undefined,
        parseTaskCreateOutput(chunk.content),
      );
    } else if (toolUse.name === "TaskUpdate") {
      applyTaskUpdate(
        ctx.taskState,
        toolUse.input as TaskUpdateInput | undefined,
      );
    }
    if (toolUse.name === "TaskCreate" || toolUse.name === "TaskUpdate") {
      return [
        {
          sessionUpdate: "plan",
          entries: taskStateToPlanEntries(ctx.taskState),
        },
      ];
    }
    return [];
  }

  if (!chunk.is_error) {
    updateFileContentCache(toolUse, chunk, ctx);
  }

  const { _meta: resultMeta, ...toolUpdate } = toolUpdateFromToolResult(
    chunk as Parameters<typeof toolUpdateFromToolResult>[0],
    toolUse,
    {
      supportsTerminalOutput: ctx.supportsTerminalOutput,
      toolUseId: chunk.tool_use_id,
      cachedFileContent: ctx.fileContentCache,
      enrichedReadCache: ctx.enrichedReadCache,
    },
  );

  const updates: SessionUpdate[] = [];

  if (resultMeta?.terminal_output) {
    const terminalOutputMeta: Record<string, unknown> = {
      terminal_output: resultMeta.terminal_output,
    };
    if (ctx.parentToolCallId) {
      terminalOutputMeta.claudeCode = {
        parentToolCallId: ctx.parentToolCallId,
      };
    }
    updates.push({
      _meta: terminalOutputMeta,
      toolCallId: chunk.tool_use_id,
      sessionUpdate: "tool_call_update" as const,
    });
  }

  const meta: Record<string, unknown> = {
    ...toolMeta(
      toolUse.name,
      undefined,
      ctx.parentToolCallId,
      bashCommandFromToolUse(toolUse),
    ),
    ...(resultMeta?.terminal_exit
      ? { terminal_exit: resultMeta.terminal_exit }
      : {}),
  };

  updates.push({
    _meta: meta,
    toolCallId: chunk.tool_use_id,
    sessionUpdate: "tool_call_update",
    status: chunk.is_error ? "failed" : "completed",
    rawOutput: ctx.mcpToolUseResult
      ? { ...ctx.mcpToolUseResult, isError: chunk.is_error ?? false }
      : {
          content: Array.isArray(chunk.content)
            ? chunk.content
            : typeof chunk.content === "string"
              ? [{ type: "text" as const, text: chunk.content }]
              : [],
          isError: chunk.is_error ?? false,
        },
    ...toolUpdate,
  });

  return updates;
}

function processContentChunk(
  chunk: AnthropicContentChunk,
  role: Role,
  ctx: ChunkHandlerContext,
): SessionUpdate[] {
  switch (chunk.type) {
    case "text":
    case "text_delta": {
      const update = handleTextChunk(chunk, role, ctx.parentToolCallId);
      return update ? [update] : [];
    }

    case "image": {
      const update = handleImageChunk(chunk, role);
      return update ? [update] : [];
    }

    case "thinking":
    case "thinking_delta": {
      const update = handleThinkingChunk(chunk, ctx.parentToolCallId);
      return update ? [update] : [];
    }

    case "tool_use":
    case "server_tool_use":
    case "mcp_tool_use": {
      const update = handleToolUseChunk(chunk as ToolUseCache[string], ctx);
      return update ? [update] : [];
    }

    case "tool_result":
    case "tool_search_tool_result":
    case "web_fetch_tool_result":
    case "web_search_tool_result":
    case "code_execution_tool_result":
    case "bash_code_execution_tool_result":
    case "text_editor_code_execution_tool_result":
    case "mcp_tool_result":
      return handleToolResultChunk(
        chunk as AnthropicContentChunk & {
          tool_use_id: string;
          is_error?: boolean;
          content?: unknown;
        },
        ctx,
      );

    case "document":
    case "search_result":
    case "redacted_thinking":
    case "input_json_delta":
    case "citations_delta":
    case "signature_delta":
    case "container_upload":
    case "compaction":
    case "compaction_delta":
    case "advisor_tool_result":
    case "mid_conv_system":
    case "fallback":
      return [];

    default:
      unreachable(chunk as never, ctx.logger);
      return [];
  }
}

function toAcpNotifications(
  content:
    | string
    | ContentBlockParam[]
    | BetaContentBlock[]
    | BetaRawContentBlockDelta[],
  role: Role,
  sessionId: string,
  toolUseCache: ToolUseCache,
  fileContentCache: { [key: string]: string },
  client: AgentSideConnection,
  logger: Logger,
  parentToolCallId?: string,
  registerHooks?: boolean,
  supportsTerminalOutput?: boolean,
  cwd?: string,
  mcpToolUseResult?: Record<string, unknown>,
  enrichedReadCache?: EnrichedReadCache,
  taskState?: TaskState,
): SessionNotification[] {
  if (typeof content === "string") {
    const update: SessionUpdate = {
      sessionUpdate: messageUpdateType(role),
      content: text(content),
    };
    if (parentToolCallId) {
      (update as Record<string, unknown>)._meta = toolMeta(
        "__text__",
        undefined,
        parentToolCallId,
      );
    }
    return [{ sessionId, update }];
  }

  const ctx: ChunkHandlerContext = {
    sessionId,
    toolUseCache,
    fileContentCache,
    enrichedReadCache,
    client,
    logger,
    parentToolCallId,
    registerHooks,
    supportsTerminalOutput,
    cwd,
    mcpToolUseResult,
    taskState,
  };
  const output: SessionNotification[] = [];

  for (const chunk of content) {
    for (const update of processContentChunk(chunk, role, ctx)) {
      output.push({ sessionId, update });
    }
  }

  return output;
}

function streamEventToAcpNotifications(
  message: SDKPartialAssistantMessage,
  sessionId: string,
  toolUseCache: ToolUseCache,
  toolUseStreamCache: ToolUseStreamCache,
  fileContentCache: { [key: string]: string },
  client: AgentSideConnection,
  logger: Logger,
  parentToolCallId?: string,
  registerHooks?: boolean,
  supportsTerminalOutput?: boolean,
  cwd?: string,
  enrichedReadCache?: EnrichedReadCache,
  taskState?: TaskState,
): SessionNotification[] {
  const event = message.event;
  switch (event.type) {
    case "content_block_start": {
      const block = event.content_block;
      if (block.type === "tool_use" || block.type === "mcp_tool_use") {
        toolUseStreamCache.set(event.index, {
          toolUseId: block.id,
          partialJson: "",
        });
      }
      return toAcpNotifications(
        [block],
        "assistant",
        sessionId,
        toolUseCache,
        fileContentCache,
        client,
        logger,
        parentToolCallId,
        registerHooks,
        supportsTerminalOutput,
        cwd,
        undefined,
        enrichedReadCache,
        taskState,
      );
    }
    case "content_block_delta": {
      if (event.delta.type === "input_json_delta") {
        return inputJsonDeltaToAcpNotifications(
          event.index,
          event.delta.partial_json,
          sessionId,
          toolUseStreamCache,
        );
      }
      return toAcpNotifications(
        [event.delta],
        "assistant",
        sessionId,
        toolUseCache,
        fileContentCache,
        client,
        logger,
        parentToolCallId,
        registerHooks,
        supportsTerminalOutput,
        cwd,
        undefined,
        enrichedReadCache,
        taskState,
      );
    }
    case "content_block_stop":
      toolUseStreamCache.delete(event.index);
      return [];
    // `ping` is a Messages-API keep-alive event that the SDK's
    // `BetaRawMessageStreamEvent` union doesn't include even though the
    // wire format emits it; the `as never` cast lets us no-op it here
    // instead of falling through to `unreachable`.
    case "ping" as never:
    case "message_start":
    case "message_delta":
    case "message_stop":
      return [];

    default:
      unreachable(event as never, logger);
      return [];
  }
}

function inputJsonDeltaToAcpNotifications(
  index: number,
  partialJson: string,
  sessionId: string,
  toolUseStreamCache: ToolUseStreamCache,
): SessionNotification[] {
  const entry = toolUseStreamCache.get(index);
  if (!entry) return [];
  entry.partialJson += partialJson;

  const parsed = tryParsePartialJson(entry.partialJson);
  if (!parsed || typeof parsed !== "object") return [];

  return [
    {
      sessionId,
      update: {
        sessionUpdate: "tool_call_update" as const,
        toolCallId: entry.toolUseId,
        rawInput: parsed as Record<string, unknown>,
      },
    },
  ];
}

export async function handleSystemMessage(
  message: Extract<SDKMessage, { type: "system" }>,
  context: MessageHandlerContext,
): Promise<void> {
  const { session, sessionId, client, logger } = context;

  switch (message.subtype) {
    case "init":
      break;
    case "compact_boundary":
      await client.extNotification(POSTHOG_NOTIFICATIONS.COMPACT_BOUNDARY, {
        sessionId,
        trigger: message.compact_metadata.trigger,
        preTokens: message.compact_metadata.pre_tokens,
        contextSize: session.contextSize,
      });
      break;
    case "hook_response":
      logger.info("Hook response received", {
        hookName: message.hook_name,
        hookEvent: message.hook_event,
      });
      break;
    case "status":
      if (message.status === "compacting") {
        logger.info("Session compacting started", { sessionId });
        await client.extNotification(POSTHOG_NOTIFICATIONS.STATUS, {
          sessionId,
          status: "compacting",
        });
      }
      break;
    case "task_notification": {
      logger.info("Task notification received", {
        sessionId,
        taskId: message.task_id,
        status: message.status,
        summary: message.summary,
      });
      await client.extNotification(POSTHOG_NOTIFICATIONS.TASK_NOTIFICATION, {
        sessionId,
        taskId: message.task_id,
        status: message.status,
        summary: message.summary,
        outputFile: message.output_file,
      });
      break;
    }
    case "memory_recall": {
      const isSynthesis = message.mode === "synthesize";
      // Skip empty recalls — they're the dominant source of UI clutter on
      // memory-heavy turns and carry no signal (no paths, no content).
      if (!isSynthesis && message.memories.length === 0) break;
      const locations = isSynthesis
        ? []
        : message.memories.map((m) => ({ path: m.path }));
      const content = isSynthesis
        ? message.memories
            .filter(
              (
                m,
              ): m is (typeof message.memories)[number] & {
                content: string;
              } => typeof m.content === "string",
            )
            .map((m) => ({
              type: "content" as const,
              content: { type: "text" as const, text: m.content },
            }))
        : [];
      const count = message.memories.length;
      const title = isSynthesis
        ? "Recalled synthesized memory"
        : `Recalled ${count} ${count === 1 ? "memory" : "memories"}`;
      await client.sessionUpdate({
        sessionId: message.session_id,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: message.uuid,
          title,
          kind: "read",
          status: "completed",
          ...(locations.length > 0 && { locations }),
          ...(content.length > 0 && { content }),
          _meta: {
            claudeCode: {
              toolName: "memory_recall",
              toolResponse: { mode: message.mode },
            },
          } satisfies ToolUpdateMeta,
        },
      });
      break;
    }
    case "mirror_error":
      logger.error(
        `Session ${sessionId}: failed to persist history: ${message.error}`,
      );
      break;
    case "permission_denied": {
      const reason = message.decision_reason ?? message.message;
      await client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: message.tool_use_id,
          status: "failed",
          content: [
            {
              type: "content",
              content: { type: "text", text: `Permission denied: ${reason}` },
            },
          ],
          _meta: {
            claudeCode: {
              toolName: message.tool_name,
              toolResponse: {
                decisionReasonType: message.decision_reason_type,
                decisionReason: message.decision_reason,
                message: message.message,
              },
            },
          } satisfies ToolUpdateMeta,
        },
      });
      break;
    }
    default:
      break;
  }
}

export type ResultMessageHandlerResult = {
  shouldStop: boolean;
  stopReason?: StopReason;
  error?: Error;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cachedReadTokens: number;
    cachedWriteTokens: number;
    costUsd?: number;
    contextWindowSize?: number;
  };
};

export function handleResultMessage(
  message: SDKResultMessage,
): ResultMessageHandlerResult {
  const usage = extractUsageFromResult(message);

  switch (message.subtype) {
    case "success": {
      if (message.result.includes("Please run /login")) {
        return {
          shouldStop: true,
          error: RequestError.authRequired(),
          usage,
        };
      }
      if ((message as Record<string, unknown>).stop_reason === "max_tokens") {
        return { shouldStop: true, stopReason: "max_tokens", usage };
      }
      if (message.is_error) {
        const classification = classifyAgentError(message.result);
        return {
          shouldStop: true,
          error: RequestError.internalError(
            { classification, result: message.result },
            message.result,
          ),
          usage,
        };
      }
      return { shouldStop: true, stopReason: "end_turn", usage };
    }
    case "error_during_execution":
      if ((message as Record<string, unknown>).stop_reason === "max_tokens") {
        return { shouldStop: true, stopReason: "max_tokens", usage };
      }
      if (message.is_error) {
        return {
          shouldStop: true,
          error: RequestError.internalError(
            undefined,
            message.errors.join(", ") || message.subtype,
          ),
          usage,
        };
      }
      return { shouldStop: true, stopReason: "end_turn", usage };
    case "error_max_budget_usd":
    case "error_max_turns":
    case "error_max_structured_output_retries":
      if (message.is_error) {
        return {
          shouldStop: true,
          error: RequestError.internalError(
            undefined,
            message.errors.join(", ") || message.subtype,
          ),
          usage,
        };
      }
      return { shouldStop: true, stopReason: "max_turn_requests", usage };
    default:
      return { shouldStop: false, usage };
  }
}

function extractUsageFromResult(
  message: SDKResultMessage,
): ResultMessageHandlerResult["usage"] {
  const msg = message as Record<string, unknown>;
  const msgUsage = msg.usage as Record<string, number> | undefined;
  if (!msgUsage) return undefined;

  const modelUsage = msg.modelUsage as
    | Record<string, { contextWindow: number }>
    | undefined;
  let contextWindowSize: number | undefined;
  if (modelUsage) {
    const contextWindows = Object.values(modelUsage).map(
      (m) => m.contextWindow,
    );
    if (contextWindows.length > 0) {
      contextWindowSize = Math.min(...contextWindows);
    }
  }

  return {
    inputTokens: msgUsage.input_tokens ?? 0,
    outputTokens: msgUsage.output_tokens ?? 0,
    cachedReadTokens: msgUsage.cache_read_input_tokens ?? 0,
    cachedWriteTokens: msgUsage.cache_creation_input_tokens ?? 0,
    costUsd:
      typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : undefined,
    contextWindowSize,
  };
}

export async function handleStreamEvent(
  message: SDKPartialAssistantMessage,
  context: MessageHandlerContext,
): Promise<void> {
  const {
    sessionId,
    client,
    toolUseCache,
    toolUseStreamCache,
    fileContentCache,
    logger,
  } = context;
  const parentToolCallId = message.parent_tool_use_id ?? undefined;

  const streamed = context.streamedAssistantBlocks;
  if (streamed) {
    if (message.event.type === "message_start") {
      streamed.currentStreamMessageId = message.event.message.id || undefined;
    }
    // Only top-level streams are recorded — subagent text is never streamed
    // and must stay filtered, as it is internal to the tool call.
    if (
      streamed.currentStreamMessageId &&
      message.parent_tool_use_id === null &&
      message.event.type === "content_block_delta"
    ) {
      if (message.event.delta.type === "text_delta") {
        streamed.textIds.add(streamed.currentStreamMessageId);
      } else if (message.event.delta.type === "thinking_delta") {
        streamed.thinkingIds.add(streamed.currentStreamMessageId);
      }
    }
  }

  for (const notification of streamEventToAcpNotifications(
    message,
    sessionId,
    toolUseCache,
    toolUseStreamCache,
    fileContentCache,
    client,
    logger,
    parentToolCallId,
    context.registerHooks,
    context.supportsTerminalOutput,
    context.session.cwd,
    context.enrichedReadCache,
    context.session.taskState,
  )) {
    await client.sessionUpdate(notification);
    context.session.notificationHistory.push(notification);
  }
}

function hasLocalCommandStdout(content: AnthropicMessageContent): boolean {
  return (
    typeof content === "string" && content.includes("<local-command-stdout>")
  );
}

function hasLocalCommandStderr(content: AnthropicMessageContent): boolean {
  return (
    typeof content === "string" && content.includes("<local-command-stderr>")
  );
}

// SDK-persisted slash command invocations always lead with `<command-name>`.
// Requiring that anchor keeps user-typed prompts that happen to contain a
// literal `<local-command-stdout>` tag from being scrubbed on session reload.
function isSdkLocalCommandMessage(content: AnthropicMessageContent): boolean {
  return (
    typeof content === "string" &&
    content.includes("<command-name>") &&
    (content.includes("<local-command-stdout>") ||
      content.includes("<local-command-stderr>"))
  );
}

// The Claude SDK persists local slash command invocations (e.g. `/model`) and
// their output as user messages wrapping the payload in these XML-like markers
// that the CLI uses for its own display. The live prompt loop must strip them
// so they don't leak into the UI, while preserving any real prose mixed in
// alongside.
const LOCAL_COMMAND_MARKERS = [
  "command-name",
  "command-message",
  "command-args",
  "local-command-stdout",
  "local-command-stderr",
].map((tag) => ({ open: `<${tag}>`, close: `</${tag}>` }));

export function stripMarkerTags(text: string): string {
  const dead = new Set<string>();
  let result = "";
  let copiedUpTo = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] === "<") {
      const marker = LOCAL_COMMAND_MARKERS.find(
        (m) => !dead.has(m.open) && text.startsWith(m.open, i),
      );
      if (marker) {
        const end = text.indexOf(marker.close, i + marker.open.length);
        if (end !== -1) {
          result += text.slice(copiedUpTo, i);
          i = copiedUpTo = end + marker.close.length;
          continue;
        }
        dead.add(marker.open);
      }
    }
    i++;
  }
  return result + text.slice(copiedUpTo);
}

/**
 * Returns the string with local-command marker tags removed, or `null` if
 * nothing renderable remains. Used to surface custom slash commands and
 * skill expansions whose bodies arrive wrapped in marker tags, while
 * still no-op'ing for pure-marker payloads like /compact.
 */
function stripLocalCommandMetadata(content: string): string | null {
  const stripped = stripMarkerTags(content);
  return stripped.trim() === "" ? null : stripped;
}

function isLoginRequiredMessage(message: AnthropicMessageWithContent): boolean {
  return (
    message.type === "assistant" &&
    message.message.model === "<synthetic>" &&
    Array.isArray(message.message.content) &&
    message.message.content.length === 1 &&
    message.message.content[0].type === "text" &&
    message.message.content[0].text?.includes("Please run /login") === true
  );
}

function isPlainTextUserMessage(message: AnthropicMessageWithContent): boolean {
  const content = message.message.content;
  return (
    message.type === "user" &&
    (typeof content === "string" ||
      (Array.isArray(content) &&
        content.length === 1 &&
        content[0].type === "text"))
  );
}

function shouldSkipUserAssistantMessage(
  message: AnthropicMessageWithContent,
): boolean {
  return (
    isSdkLocalCommandMessage(message.message.content) ||
    isLoginRequiredMessage(message)
  );
}

function logSpecialMessages(
  message: AnthropicMessageWithContent,
  logger: Logger,
): void {
  const content = message.message.content;
  if (hasLocalCommandStdout(content) && typeof content === "string") {
    logger.info(content);
  }
  if (hasLocalCommandStderr(content) && typeof content === "string") {
    logger.error(content);
  }
}

/**
 * Drops assistant `text`/`thinking` blocks that already reached the client as
 * streamed chunks, while forwarding (as a fallback) any non-empty block that
 * never streamed — see `StreamedAssistantBlocks`. Subagent assistant content
 * (`parent_tool_use_id !== null`) is never streamed and stays internal to its
 * tool call, so it is always dropped, as is everything when no tracker is
 * available (replay).
 */
function filterAssistantContent(
  message: SDKAssistantMessage,
  streamed: StreamedAssistantBlocks | undefined,
): SDKAssistantMessage["message"]["content"] {
  const content = message.message.content;
  const isTopLevel =
    "parent_tool_use_id" in message && message.parent_tool_use_id === null;
  if (!streamed || !isTopLevel) {
    return content.filter(
      (block) => block.type !== "text" && block.type !== "thinking",
    );
  }

  const id = message.message.id || undefined;
  return content.filter((block) => {
    if (block.type !== "text" && block.type !== "thinking") {
      return true;
    }
    const streamedLive =
      id !== undefined &&
      (block.type === "text" ? streamed.textIds : streamed.thinkingIds).has(id);
    if (streamedLive) {
      return false;
    }
    // Some gateways emit an empty `thinking` block before the real text —
    // don't forward stray empty chunks.
    const blockText = block.type === "text" ? block.text : block.thinking;
    return blockText.length > 0;
  });
}

export async function handleUserAssistantMessage(
  message: SDKUserMessage | SDKAssistantMessage,
  context: MessageHandlerContext,
): Promise<{ shouldStop?: boolean; error?: Error }> {
  const { session, sessionId, client, toolUseCache, fileContentCache, logger } =
    context;

  // System-role payloads (e.g. SDK-injected reminders) reach the user/assistant
  // switch but are never user-visible content; skip rendering them entirely.
  if (message.message.role === "system") {
    return {};
  }

  if (shouldSkipUserAssistantMessage(message)) {
    logSpecialMessages(message, logger);

    if (isLoginRequiredMessage(message)) {
      return { shouldStop: true, error: RequestError.authRequired() };
    }

    // Strip local-command marker tags and render whatever real prose remains
    // so that custom slash commands and skill expansions (whose bodies arrive
    // wrapped in <command-*> / <local-command-stdout> markers) reach the UI.
    // Pure-marker payloads (e.g. /compact) still no-op via the `null` branch.
    const rawContent = message.message.content;
    if (typeof rawContent === "string") {
      const stripped = stripLocalCommandMetadata(rawContent);
      if (stripped !== null) {
        for (const notification of toAcpNotifications(
          stripped,
          message.message.role as Role,
          sessionId,
          toolUseCache,
          fileContentCache,
          client,
          logger,
          undefined,
          context.registerHooks,
          context.supportsTerminalOutput,
          session.cwd,
          undefined,
          context.enrichedReadCache,
          session.taskState,
        )) {
          await client.sessionUpdate(notification);
          session.notificationHistory.push(notification);
        }
      }
    }
    return {};
  }

  // Skip plain text user messages (already displayed by the ACP client)
  if (isPlainTextUserMessage(message)) {
    return {};
  }

  const content = message.message.content;
  const contentToProcess =
    message.type === "assistant"
      ? filterAssistantContent(message, context.streamedAssistantBlocks)
      : content;
  const parentToolCallId =
    "parent_tool_use_id" in message
      ? (message.parent_tool_use_id ?? undefined)
      : undefined;

  // Pass the raw MCP tool result (contains content, structuredContent, _meta)
  // so it can be forwarded as-is to the renderer for MCP Apps
  const mcpToolUseResult =
    message.type === "user" && message.tool_use_result != null
      ? (message.tool_use_result as Record<string, unknown>)
      : undefined;

  for (const notification of toAcpNotifications(
    contentToProcess as typeof content,
    message.message.role as Role,
    sessionId,
    toolUseCache,
    fileContentCache,
    client,
    logger,
    parentToolCallId,
    context.registerHooks,
    context.supportsTerminalOutput,
    session.cwd,
    mcpToolUseResult,
    context.enrichedReadCache,
    session.taskState,
  )) {
    await client.sessionUpdate(notification);
    session.notificationHistory.push(notification);
  }

  return {};
}
