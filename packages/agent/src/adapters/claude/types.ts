import type {
  SessionConfigOption,
  TerminalHandle,
  TerminalOutputResponse,
} from "@agentclientprotocol/sdk";
import type {
  Options,
  Query,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { Pushable } from "../../utils/streams";
import type { BaseSession } from "../base-acp-agent";
import type { McpToolApprovals } from "./mcp/tool-metadata";
import type { SettingsManager } from "./session/settings";
import type { CodeExecutionMode } from "./tools";

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export type AccumulatedUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cachedWriteTokens: number;
};

export type BackgroundTerminal =
  | {
      handle: TerminalHandle;
      status: "started";
      lastOutput: TerminalOutputResponse | null;
    }
  | {
      status: "aborted" | "exited" | "killed" | "timedOut";
      pendingOutput: TerminalOutputResponse;
    };

export type PendingMessage = {
  resolve: (cancelled: boolean) => void;
  order: number;
};

export type Session = BaseSession & {
  query: Query;
  /** The Options object passed to query() — mutating it affects subsequent prompts */
  queryOptions: Options;
  input: Pushable<SDKUserMessage>;
  settingsManager: SettingsManager;
  permissionMode: CodeExecutionMode;
  modeBeforePlan?: CodeExecutionMode;
  modelId?: string;
  cwd: string;
  taskRunId?: string;
  lastPlanFilePath?: string;
  lastPlanContent?: string;
  effort?: EffortLevel;
  configOptions: SessionConfigOption[];
  accumulatedUsage: AccumulatedUsage;
  /** Latest context window usage (total tokens from last assistant message) */
  contextUsed?: number;
  /** Context window size in tokens */
  contextSize?: number;
  /** Persists across prompt() calls so SDK-reported values survive turn boundaries */
  lastContextWindowSize?: number;
  promptRunning: boolean;
  pendingMessages: Map<string, PendingMessage>;
  nextPendingOrder: number;
  emitRawSDKMessages: boolean | SDKMessageFilter[];
};

export type ToolUseCache = {
  [key: string]: {
    type: "tool_use" | "server_tool_use" | "mcp_tool_use";
    id: string;
    name: string;
    input: unknown;
  };
};

/**
 * Per-content-block-index buffer for tool inputs streamed via
 * `input_json_delta` events. Keyed by the Anthropic content block index
 * (which resets per assistant message). Cleared on `content_block_stop`.
 */
export type ToolUseStreamCache = Map<
  number,
  { toolUseId: string; partialJson: string }
>;

export type TerminalInfo = {
  terminal_id: string;
};

export type TerminalOutput = {
  terminal_id: string;
  data: string;
};

export type TerminalExit = {
  terminal_id: string;
  exit_code: number | null;
  signal: string | null;
};

export type ToolUpdateMeta = {
  claudeCode?: {
    toolName: string;
    toolResponse?: unknown;
    parentToolCallId?: string;
    bashCommand?: string;
  };
  terminal_info?: TerminalInfo;
  terminal_output?: TerminalOutput;
  terminal_exit?: TerminalExit;
};

export type SDKMessageFilter = {
  type: string;
  subtype?: string;
};

export type NewSessionMeta = {
  taskRunId?: string;
  disableBuiltInTools?: boolean;
  systemPrompt?: unknown;
  sessionId?: string;
  permissionMode?: string;
  persistence?: { taskId?: string; runId?: string; logUrl?: string };
  additionalRoots?: string[];
  allowedDomains?: string[];
  /** Model ID to use for this session (e.g. "claude-sonnet-4-6") */
  model?: string;
  jsonSchema?: Record<string, unknown> | null;
  mcpToolApprovals?: McpToolApprovals;
  claudeCode?: {
    options?: Options;
    emitRawSDKMessages?: boolean | SDKMessageFilter[];
  };
};
