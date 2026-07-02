import type {
  PromptResponse,
  SessionConfigOption,
  TerminalHandle,
  TerminalOutputResponse,
} from "@agentclientprotocol/sdk";
import type {
  McpSdkServerConfigWithInstance,
  Options,
  Query,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { PostHogProductId } from "../../posthog-products";
import type { Pushable } from "../../utils/streams";
import type { BaseSession } from "../base-acp-agent";
import type { ContextBreakdownBaseline } from "./context-breakdown";
import type { TaskState } from "./conversion/task-state";
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

/** One in-flight `prompt()` call. A persistent per-session consumer (see
 *  `runConsumer` in claude-agent.ts) drains the SDK query stream for the whole
 *  session and settles each Turn's deferred when that turn's outcome is known,
 *  so `prompt()` itself holds no loop. Turns are processed FIFO: the SDK
 *  echoes queued user messages back in submission order, so the first
 *  unsettled queue entry is the turn currently running. */
export type Turn = {
  /** uuid stamped on the pushed `SDKUserMessage`; the SDK echoes it back so
   *  the consumer can match the replayed user message to this turn. */
  promptUuid: string;
  /** Local-only slash commands (e.g. `/context`) return a result without an
   *  echo, so the consumer can't promote them via the replay; it falls back
   *  to promoting the queue head when the result arrives. */
  isLocalOnlyCommand: boolean;
  /** Leading slash command of the prompt (e.g. "/foo"), if any. Drives the
   *  unsupported-slash-command gate when idle arrives without an echo. */
  commandName?: string;
  /** Mirrors the prompt's chunks to the feed/history. Invoked once, when the
   *  turn activates, preserving the pre-consumer timing where a queued
   *  prompt's broadcast fired when its turn took over the loop. */
  broadcast: () => Promise<void>;
  /** Set once the deferred has been resolved/rejected, so the consumer never
   *  settles a turn twice (idle + handoff + stream-end can all race). */
  settled: boolean;
  resolve: (response: PromptResponse) => void;
  reject: (error: unknown) => void;
};

export type Session = BaseSession & {
  query: Query;
  /** The Options object passed to query() — mutating it affects subsequent prompts */
  queryOptions: Options;
  /** Rebuilds the in-process ("sdk") signed-commit server with a fresh instance
   * each call (reusing one throws "Already connected"); {} when none is enabled. */
  buildInProcessMcpServers: () => Record<
    string,
    McpSdkServerConfigWithInstance
  >;
  /** Names of the in-process servers registered at session start. Lets the
   * self-heal check status without rebuilding instances on every prompt. */
  localToolsServerNames: string[];
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
  /** The user's Fast mode intent. Persists across model switches; the "fast"
   *  config option is only surfaced while the selected model supports it. */
  fastModeEnabled: boolean;
  /** Last session title pushed to the client via `session_info_update`. The
   *  SDK auto-generates the title in a background task and persists it to the
   *  session file; it is polled at turn-end and only pushed on change. */
  lastTitle?: string;
  configOptions: SessionConfigOption[];
  accumulatedUsage: AccumulatedUsage;
  /** PostHog products used during this session, derived from MCP exec calls.
   *  Accumulates for the whole session (deduped); each newly-seen product is
   *  emitted immediately so the client can show a persistent, de-duplicated
   *  list. Never reset between turns. */
  sessionResources: Set<PostHogProductId>;
  /** Latest context window usage (total tokens from last assistant message) */
  contextUsed?: number;
  /** Context window size in tokens */
  contextSize?: number;
  /** Persists across prompt() calls so SDK-reported values survive turn boundaries */
  lastContextWindowSize?: number;
  /** FIFO of in-flight prompts. The head is the turn the SDK is currently
   *  processing; later entries are queued and will be echoed in order. */
  turnQueue: Turn[];
  /** The turn whose messages the consumer is currently attributing output to
   *  (the head of `turnQueue` once its user message has been echoed). */
  activeTurn: Turn | null;
  /** Count of result messages the consumer should treat as orphans and skip.
   *  When cancel() settles+removes a queued turn, that turn's user message was
   *  already pushed to the SDK, so the SDK still runs it and emits a result
   *  with no uuid to match. The SDK processes input FIFO, so those orphan
   *  results arrive before the next live turn's; skipping exactly this many
   *  leaves the genuine head untouched. Reset to 0 on every activation. */
  pendingOrphanResults: number;
  /** The long-lived consumer task. Lazily started on the first `prompt()` and
   *  kept alive for the session so between-turn/background messages are still
   *  drained and forwarded. */
  consumer?: Promise<void>;
  /** Bumped by refreshSession before it swaps `query`/`input`, so the old
   *  consumer (which captured the previous generation) exits quietly instead
   *  of tearing down the refreshed session. */
  queryGeneration: number;
  /** Set once the SDK query stream has terminated (ran to `done` or threw).
   *  The query iterator is not reusable afterward, so a later `prompt()`
   *  rejects up front instead of enqueueing onto a dead stream and hanging. */
  queryClosed?: boolean;
  cancelController?: AbortController;
  forceCancelTimer?: ReturnType<typeof setTimeout>;
  emitRawSDKMessages: boolean | SDKMessageFilter[];
  /** Refreshed at session init and on MCP/skill changes. */
  contextBreakdownBaseline?: ContextBreakdownBaseline;
  /**
   * Slash command names (without leading slash) the SDK recognizes for this
   * session — built-ins plus plugin/skill commands. Captured from the SDK's
   * init response. Used to distinguish "command produced no output" from
   * "command is genuinely unknown" when the session goes idle without an echo.
   */
  knownSlashCommands?: Set<string>;
  /**
   * Per-session task list accumulated from Task* tool calls.
   * SDK >=0.3.142 replaced TodoWrite (snapshot) with TaskCreate/TaskUpdate
   * (incremental, keyed by task id). Map iteration preserves insertion order
   * which we use for plan entry ordering.
   */
  taskState: TaskState;
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
  taskId?: string;
  environment?: "local" | "cloud";
  disableBuiltInTools?: boolean;
  systemPrompt?: unknown;
  sessionId?: string;
  permissionMode?: string;
  persistence?: { taskId?: string; runId?: string; logUrl?: string };
  additionalRoots?: string[];
  allowedDomains?: string[];
  /** Model ID to use for this session (e.g. "claude-sonnet-4-6") */
  model?: string;
  /** Base branch of the task's repo (e.g. "master"), for the signed-git tools. */
  baseBranch?: string;
  /**
   * Repo-less channel "generic chat box" session: enables the lazy-repo tools
   * (list_repos / clone_repo) and channel guidance. The agent decides at
   * runtime whether it needs a repo and clones one only if so.
   */
  channelMode?: boolean;
  jsonSchema?: Record<string, unknown> | null;
  mcpToolApprovals?: McpToolApprovals;
  claudeCode?: {
    options?: Options;
    emitRawSDKMessages?: boolean | SDKMessageFilter[];
  };
};
