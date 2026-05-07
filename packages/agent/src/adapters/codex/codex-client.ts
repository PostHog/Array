/**
 * ACP Client implementation for communicating with codex-acp subprocess.
 *
 * This acts as the "client" from codex-acp's perspective: it receives
 * permission requests, session updates, file I/O, and terminal operations
 * from codex-acp and delegates them to the upstream PostHog Code client.
 */

import type {
  AgentSideConnection,
  Client,
  CreateTerminalRequest,
  CreateTerminalResponse,
  KillTerminalRequest,
  KillTerminalResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  TerminalHandle,
  TerminalOutputRequest,
  TerminalOutputResponse,
  ToolKind,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from "@agentclientprotocol/sdk";
import {
  enrichFileForAgent,
  type FileEnrichmentDeps,
} from "../../enrichment/file-enricher";
import type { PermissionMode } from "../../execution-mode";
import type { Logger } from "../../utils/logger";
import type { CodexSessionState } from "./session-state";
import {
  STRUCTURED_OUTPUT_MCP_NAME,
  STRUCTURED_OUTPUT_TOOL_NAME,
} from "./structured-output-constants";

export interface CodexClientCallbacks {
  /** Called when a usage_update session notification is received */
  onUsageUpdate?: (update: Record<string, unknown>) => void;
  /** When set, Read responses are annotated with PostHog enrichment before reaching codex-acp. */
  enrichmentDeps?: FileEnrichmentDeps;
  /**
   * Called once per session when the agent completes the injected
   * `create_output` MCP tool. Matches the Claude adapter's structured
   * output delivery.
   */
  onStructuredOutput?: (output: Record<string, unknown>) => Promise<void>;
}

/**
 * Tool calls for our injected MCP server surface in ACP `tool_call` /
 * `tool_call_update` notifications. The `title` from codex-acp can be
 * either the bare tool name or prefixed (`mcp__<server>__<tool>`); match
 * both forms but require the server name on prefixed titles so an unrelated
 * user tool happening to contain `create_output` doesn't trigger us.
 */
function isStructuredOutputToolCall(title: string | undefined | null): boolean {
  if (!title) return false;
  if (title === STRUCTURED_OUTPUT_TOOL_NAME) return true;
  return (
    title.includes(STRUCTURED_OUTPUT_MCP_NAME) &&
    title.includes(STRUCTURED_OUTPUT_TOOL_NAME)
  );
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

const AUTO_APPROVED_KINDS: Record<PermissionMode, Set<ToolKind>> = {
  default: new Set(["read", "search", "fetch", "think"]),
  acceptEdits: new Set(["read", "edit", "search", "fetch", "think"]),
  plan: new Set(["read", "search", "fetch", "think"]),
  bypassPermissions: new Set([
    "read",
    "edit",
    "delete",
    "move",
    "search",
    "execute",
    "think",
    "fetch",
    "switch_mode",
    "other",
  ]),
  auto: new Set(["read", "search", "fetch", "think"]),
  "read-only": new Set(["read", "search", "fetch", "think"]),
  "full-access": new Set([
    "read",
    "edit",
    "delete",
    "move",
    "search",
    "execute",
    "think",
    "fetch",
    "switch_mode",
    "other",
  ]),
};

function shouldAutoApprove(
  mode: PermissionMode,
  kind: ToolKind | null | undefined,
): boolean {
  if (mode === "bypassPermissions" || mode === "full-access") return true;
  if (!kind) return false;
  return AUTO_APPROVED_KINDS[mode]?.has(kind) ?? false;
}

/**
 * Creates an ACP Client that delegates all requests from codex-acp
 * to the upstream PostHog Code client (via AgentSideConnection).
 */
export function createCodexClient(
  upstreamClient: AgentSideConnection,
  logger: Logger,
  sessionState: CodexSessionState,
  callbacks?: CodexClientCallbacks,
): Client {
  const terminalHandles = new Map<string, TerminalHandle>();
  // Track rawInput across tool_call → tool_call_update → completed so we can
  // fire onStructuredOutput exactly once per tool call id. Entries stay in
  // the map after firing with `fired: true` so a re-emitted completion
  // (if codex-acp ever resends one) is a no-op.
  const structuredOutputState = new Map<
    string,
    { rawInput?: Record<string, unknown>; fired: boolean }
  >();

  return {
    async requestPermission(
      params: RequestPermissionRequest,
    ): Promise<RequestPermissionResponse> {
      const kind = params.toolCall?.kind as ToolKind | null | undefined;

      if (shouldAutoApprove(sessionState.permissionMode, kind)) {
        logger.debug("Auto-approving permission", {
          mode: sessionState.permissionMode,
          kind,
          toolCallId: params.toolCall?.toolCallId,
        });
        const allowOption = params.options?.find(
          (o) => o.kind === "allow_once" || o.kind === "allow_always",
        );
        return {
          outcome: {
            outcome: "selected",
            optionId: allowOption?.optionId ?? "allow",
          },
        };
      }

      return upstreamClient.requestPermission(params);
    },

    async sessionUpdate(params: SessionNotification): Promise<void> {
      const update = params.update as Record<string, unknown> | undefined;

      if (
        callbacks?.onStructuredOutput &&
        (update?.sessionUpdate === "tool_call" ||
          update?.sessionUpdate === "tool_call_update")
      ) {
        const toolCallId = update.toolCallId as string | undefined;
        const title = update.title as string | undefined;
        if (toolCallId && isStructuredOutputToolCall(title)) {
          const entry = structuredOutputState.get(toolCallId) ?? {
            fired: false,
          };
          const rawInput = toRecord(update.rawInput);
          if (rawInput) entry.rawInput = rawInput;
          structuredOutputState.set(toolCallId, entry);

          if (update.status === "completed" && !entry.fired && entry.rawInput) {
            entry.fired = true;
            try {
              await callbacks.onStructuredOutput(entry.rawInput);
            } catch (err) {
              logger.warn("onStructuredOutput callback threw", { error: err });
            }
          }
        }
      }

      if (update?.sessionUpdate === "usage_update") {
        const used = update.used as number | undefined;
        const size = update.size as number | undefined;
        if (used !== undefined) sessionState.contextUsed = used;
        if (size !== undefined) sessionState.contextSize = size;

        // Accumulate per-message token usage when available
        const inputTokens = update.inputTokens as number | undefined;
        const outputTokens = update.outputTokens as number | undefined;
        if (inputTokens !== undefined) {
          sessionState.accumulatedUsage.inputTokens += inputTokens;
        }
        if (outputTokens !== undefined) {
          sessionState.accumulatedUsage.outputTokens += outputTokens;
        }
        const cachedRead = update.cachedReadTokens as number | undefined;
        const cachedWrite = update.cachedWriteTokens as number | undefined;
        if (cachedRead !== undefined) {
          sessionState.accumulatedUsage.cachedReadTokens += cachedRead;
        }
        if (cachedWrite !== undefined) {
          sessionState.accumulatedUsage.cachedWriteTokens += cachedWrite;
        }

        callbacks?.onUsageUpdate?.(update);
      }

      await upstreamClient.sessionUpdate(params);
    },

    async readTextFile(
      params: ReadTextFileRequest,
    ): Promise<ReadTextFileResponse> {
      const response = await upstreamClient.readTextFile(params);
      if (!callbacks?.enrichmentDeps) return response;
      const enriched = await enrichFileForAgent(
        callbacks.enrichmentDeps,
        params.path,
        response.content,
      );
      return enriched ? { ...response, content: enriched } : response;
    },

    async writeTextFile(
      params: WriteTextFileRequest,
    ): Promise<WriteTextFileResponse> {
      return upstreamClient.writeTextFile(params);
    },

    async createTerminal(
      params: CreateTerminalRequest,
    ): Promise<CreateTerminalResponse> {
      const handle = await upstreamClient.createTerminal(params);
      terminalHandles.set(handle.id, handle);
      return { terminalId: handle.id };
    },

    async terminalOutput(
      params: TerminalOutputRequest,
    ): Promise<TerminalOutputResponse> {
      const handle = terminalHandles.get(params.terminalId);
      if (!handle) {
        return { output: "", truncated: false };
      }
      return handle.currentOutput();
    },

    async releaseTerminal(
      params: ReleaseTerminalRequest,
    ): Promise<ReleaseTerminalResponse | undefined> {
      const handle = terminalHandles.get(params.terminalId);
      if (handle) {
        terminalHandles.delete(params.terminalId);
        const result = await handle.release();
        return result ?? undefined;
      }
    },

    async waitForTerminalExit(
      params: WaitForTerminalExitRequest,
    ): Promise<WaitForTerminalExitResponse> {
      const handle = terminalHandles.get(params.terminalId);
      if (!handle) {
        return { exitCode: 1 };
      }
      return handle.waitForExit();
    },

    async killTerminal(
      params: KillTerminalRequest,
    ): Promise<KillTerminalResponse | undefined> {
      const handle = terminalHandles.get(params.terminalId);
      if (handle) {
        return handle.kill();
      }
    },

    async extMethod(
      method: string,
      params: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      return upstreamClient.extMethod(method, params);
    },

    async extNotification(
      method: string,
      params: Record<string, unknown>,
    ): Promise<void> {
      return upstreamClient.extNotification(method, params);
    },
  };
}
