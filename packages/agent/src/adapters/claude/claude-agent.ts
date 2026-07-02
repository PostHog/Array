import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  type AgentSideConnection,
  type ClientCapabilities,
  type ForkSessionRequest,
  type ForkSessionResponse,
  type InitializeRequest,
  type InitializeResponse,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
  RequestError,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
  type SessionConfigOption,
  type SessionConfigOptionCategory,
  type SessionConfigSelectOption,
  type SessionModeState,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
  type Usage,
} from "@agentclientprotocol/sdk";
import {
  type CanUseTool,
  type FastModeState,
  getSessionInfo,
  getSessionMessages,
  listSessions,
  type McpSdkServerConfigWithInstance,
  type McpServerConfig,
  type Options,
  type Query,
  query,
  type SDKUserMessage,
  type SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import { serializeError } from "@posthog/shared";
import { v7 as uuidv7 } from "uuid";
import packageJson from "../../../package.json" with { type: "json" };
import {
  isMethod,
  POSTHOG_METHODS,
  POSTHOG_NOTIFICATIONS,
} from "../../acp-extensions";
import {
  createEnrichment,
  type Enrichment,
  type FileEnrichmentDeps,
} from "../../enrichment/file-enricher";
import {
  classifyPostHogExecCall,
  isUnclassifiedPostHogSubTool,
  POSTHOG_PRODUCTS,
  type PostHogProductId,
} from "../../posthog-products";
import type { PostHogAPIConfig } from "../../types";
import {
  isCloudRun,
  unreachable,
  withAbort,
  withTimeout,
} from "../../utils/common";
import { resolveGithubToken } from "../../utils/github-token";
import { Logger } from "../../utils/logger";
import { Pushable } from "../../utils/streams";
import { BaseAcpAgent } from "../base-acp-agent";
import { LOCAL_TOOLS_MCP_NAME } from "../local-tools";
import { resolveTaskId } from "../session-meta";
import {
  buildBreakdown,
  emptyBaseline,
  estimateMcpTokens,
  estimateRulesTokens,
  estimateSkillsTokens,
  estimateSystemPrompt,
} from "./context-breakdown";
import { isSteerMeta, promptToClaude } from "./conversion/acp-to-sdk";
import {
  handleResultMessage,
  handleStreamEvent,
  handleSystemMessage,
  handleUserAssistantMessage,
} from "./conversion/sdk-to-acp";
import {
  rehydrateTaskState,
  type TaskState,
  taskStateToPlanEntries,
} from "./conversion/task-state";
import type { EnrichedReadCache } from "./hooks";
import { createLocalToolsMcpServer } from "./mcp/local-tools";
import {
  clearMcpToolMetadataCache,
  fetchMcpToolMetadata,
  getCachedMcpTools,
  getConnectedMcpServerNames,
  setMcpToolApprovalStates,
} from "./mcp/tool-metadata";
import { canUseTool } from "./permissions/permission-handlers";
import { getAvailableSlashCommands } from "./session/commands";
import { parseMcpServers } from "./session/mcp-config";
import {
  applyAvailableModelsAllowlist,
  resolveInitialModelId,
} from "./session/model-config";
import {
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
  fastModeStateEnabled,
  getEffortOptions,
  resolveEffortForModel,
  resolveModelPreference,
  supports1MContext,
  supportsFastMode,
  supportsMcpInjection,
  toSdkModelId,
} from "./session/models";
import {
  buildSessionOptions,
  buildSystemPrompt,
  type GatewayEnv,
  type ProcessSpawnedInfo,
} from "./session/options";
import { SettingsManager } from "./session/settings";
import {
  CODE_EXECUTION_MODES,
  type CodeExecutionMode,
  getAvailableModes,
} from "./tools";
import type {
  BackgroundTerminal,
  EffortLevel,
  NewSessionMeta,
  SDKMessageFilter,
  Session,
  ToolUpdateMeta,
  ToolUseCache,
  ToolUseStreamCache,
  Turn,
} from "./types";

const SESSION_VALIDATION_TIMEOUT_MS = 30_000;

// Pre-prompt self-heal runs on every cloud turn; bound the status RPC so a
// wedged control channel can't stall the turn.
const MCP_STATUS_TIMEOUT_MS = 5_000;

const DEFAULT_FORCE_CANCEL_GRACE_MS = 30_000;

/** Returned when a prompt or cancel targets a session whose SDK query stream
 *  has already ended (ran to `done` or died). The stream is not revivable, so
 *  the only recovery is a fresh session. */
const SESSION_ENDED_MESSAGE =
  "The Claude Agent session has ended. Please start a new session.";

const MAX_TITLE_LENGTH = 256;
const LOCAL_ONLY_COMMANDS = new Set(["/context", "/heapdump", "/extra-usage"]);

function isSdkMcpServer(
  cfg: McpServerConfig,
): cfg is McpSdkServerConfigWithInstance {
  return cfg.type === "sdk";
}

function externalMcpServers(
  servers: Record<string, McpServerConfig> | undefined,
): Record<string, McpServerConfig> {
  return Object.fromEntries(
    Object.entries(servers ?? {}).filter(([, cfg]) => !isSdkMcpServer(cfg)),
  );
}

// Best-effort: silent on ENOENT, logs other errors so permission failures
// aren't masked.
function readClaudeMdQuietly(cwd: string, logger: Logger): string | undefined {
  try {
    return fs.readFileSync(path.join(cwd, "CLAUDE.md"), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      logger.warn("Failed to read CLAUDE.md for context breakdown", {
        cwd,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return undefined;
  }
}

function collectKnownSlashCommands(
  commands: SlashCommand[] | undefined,
): Set<string> {
  const names = new Set<string>();
  if (!commands) return names;
  for (const cmd of commands) {
    if (cmd.name) names.add(cmd.name);
  }
  return names;
}

function sanitizeTitle(text: string): string {
  const sanitized = text
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (sanitized.length <= MAX_TITLE_LENGTH) {
    return sanitized;
  }
  return `${sanitized.slice(0, MAX_TITLE_LENGTH - 1)}…`;
}

function shouldEmitRawMessage(
  config: boolean | SDKMessageFilter[],
  message: { type: string; subtype?: string },
): boolean {
  if (config === true) return true;
  if (config === false) return false;
  return config.some(
    (f) =>
      f.type === message.type &&
      (f.subtype === undefined || f.subtype === message.subtype),
  );
}

async function fetchContextUsedTokens(
  sdkQuery: Query,
  logger: Logger,
): Promise<number | null> {
  try {
    const usage = await sdkQuery.getContextUsage();
    return usage.totalTokens;
  } catch (error) {
    logger.error("Failed to fetch context usage from SDK:", error);
    return null;
  }
}

export interface ClaudeAcpAgentOptions {
  onProcessSpawned?: (info: ProcessSpawnedInfo) => void;
  onProcessExited?: (pid: number) => void;
  onMcpServersReady?: (serverNames: string[]) => void;
  onStructuredOutput?: (output: Record<string, unknown>) => Promise<void>;
  posthogApiConfig?: PostHogAPIConfig;
  /** Explicit gateway config — avoids global process.env mutation across concurrent sessions. */
  gatewayEnv?: GatewayEnv;
}

export class ClaudeAcpAgent extends BaseAcpAgent {
  readonly adapterName = "claude";
  declare session: Session;
  toolUseCache: ToolUseCache;
  /** Tool_use ids already surfaced to the client as a `tool_call`, so the
   *  second source to encounter one (permission request vs streamed tool_use —
   *  the SDK can invoke `canUseTool` before or after the block streams) sends a
   *  `tool_call_update` instead of a duplicate `tool_call`. Pruned at
   *  `tool_result` time alongside `toolUseCache`. */
  emittedToolCalls: Set<string>;
  toolUseStreamCache: ToolUseStreamCache;
  backgroundTerminals: { [key: string]: BackgroundTerminal } = {};
  clientCapabilities?: ClientCapabilities;
  forceCancelGraceMs: number = DEFAULT_FORCE_CANCEL_GRACE_MS;
  private options?: ClaudeAcpAgentOptions;
  private enrichment?: Enrichment;
  private enrichedReadCache: EnrichedReadCache = new Map();

  constructor(client: AgentSideConnection, options?: ClaudeAcpAgentOptions) {
    super(client);
    this.options = options;
    this.toolUseCache = {};
    this.emittedToolCalls = new Set();
    this.toolUseStreamCache = new Map();
    this.logger = new Logger({ debug: true, prefix: "[ClaudeAcpAgent]" });
    this.enrichment = createEnrichment(options?.posthogApiConfig, this.logger);
  }

  protected getEnrichmentDeps(): FileEnrichmentDeps | undefined {
    return this.enrichment?.deps;
  }

  override async closeSession(): Promise<void> {
    try {
      await super.closeSession();
    } finally {
      this.enrichment?.dispose();
      this.enrichment = undefined;
      this.enrichedReadCache.clear();
    }
  }

  async initialize(request: InitializeRequest): Promise<InitializeResponse> {
    this.clientCapabilities = request.clientCapabilities;

    return {
      protocolVersion: 1,
      agentCapabilities: {
        promptCapabilities: {
          image: true,
          embeddedContext: true,
        },
        mcpCapabilities: {
          http: true,
          sse: true,
        },
        loadSession: true,
        sessionCapabilities: {
          additionalDirectories: {},
          list: {},
          fork: {},
          resume: {},
        },
        _meta: {
          posthog: {
            resumeSession: true,
            steering: "native",
          },
          claudeCode: {
            promptQueueing: true,
          },
        },
      },
      agentInfo: {
        name: packageJson.name,
        title: "Claude Agent",
        version: packageJson.version,
      },
      authMethods: [],
    };
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    // Upstream Claude Code renames .claude.json to .claude.json.backup on logout.
    // If the backup exists but the original doesn't, the user is logged out.
    if (
      fs.existsSync(path.resolve(os.homedir(), ".claude.json.backup")) &&
      !fs.existsSync(path.resolve(os.homedir(), ".claude.json"))
    ) {
      throw RequestError.authRequired();
    }

    const response = await this.createSession(
      {
        cwd: params.cwd,
        mcpServers: params.mcpServers ?? [],
        additionalDirectories: params.additionalDirectories,
        _meta: params._meta,
      },
      {
        // Revisit these meta values once we support resume
        resume: (params._meta as NewSessionMeta | undefined)?.claudeCode
          ?.options?.resume as string | undefined,
      },
    );

    return response;
  }

  async unstable_forkSession(
    params: ForkSessionRequest,
  ): Promise<ForkSessionResponse> {
    return this.createSession(
      {
        cwd: params.cwd,
        mcpServers: params.mcpServers ?? [],
        additionalDirectories: params.additionalDirectories,
        _meta: params._meta,
      },
      { resume: params.sessionId, forkSession: true },
    );
  }

  async resumeSession(
    params: ResumeSessionRequest,
  ): Promise<ResumeSessionResponse> {
    // Reuse existing session if it matches
    const existing = this.getExistingSessionState(params.sessionId);
    if (existing) return existing;

    const response = await this.createSession(
      {
        cwd: params.cwd,
        mcpServers: params.mcpServers ?? [],
        additionalDirectories: params.additionalDirectories,
        _meta: params._meta,
      },
      {
        resume: params.sessionId,
      },
    );

    await this.rehydrateTaskStateFromJsonl(params.sessionId);

    return response;
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    // Reuse existing session if it matches
    const existing = this.getExistingSessionState(params.sessionId);
    if (existing) return existing;

    const response = await this.createSession(
      {
        cwd: params.cwd,
        mcpServers: params.mcpServers ?? [],
        additionalDirectories: params.additionalDirectories,
        _meta: params._meta,
      },
      { resume: params.sessionId, skipBackgroundFetches: true },
    );

    await this.replaySessionHistory(params.sessionId);

    // Send available commands after replay so they don't interleave with history
    this.deferBackgroundFetches(this.session.query);

    return {
      modes: response.modes,
      configOptions: response.configOptions,
    };
  }

  async listSessions(
    params: ListSessionsRequest,
  ): Promise<ListSessionsResponse> {
    const sdkSessions = await listSessions({ dir: params.cwd ?? undefined });
    const sessions = [];

    for (const session of sdkSessions) {
      if (!session.cwd) continue;
      sessions.push({
        sessionId: session.sessionId,
        cwd: session.cwd,
        title: sanitizeTitle(session.customTitle || session.summary || ""),
        updatedAt: new Date(session.lastModified).toISOString(),
      });
    }
    return {
      sessions,
    };
  }

  async unstable_listSessions(
    params: ListSessionsRequest,
  ): Promise<ListSessionsResponse> {
    return this.listSessions(params);
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const userMessage = promptToClaude(params);
    const promptUuid = randomUUID();
    userMessage.uuid = promptUuid;
    let isLocalOnlyCommand = false;

    // Detect local-only slash commands that return results without model invocation
    const msgContent = userMessage.message.content;
    let firstTextPart = "";
    if (typeof msgContent === "string") {
      firstTextPart = msgContent;
    } else if (Array.isArray(msgContent)) {
      for (const block of msgContent) {
        if ("type" in block && block.type === "text" && "text" in block) {
          firstTextPart = block.text as string;
          break;
        }
      }
    }
    const commandMatch = firstTextPart.match(/^(\/\S+)/);
    if (commandMatch && LOCAL_ONLY_COMMANDS.has(commandMatch[1])) {
      isLocalOnlyCommand = true;
    }

    if (commandMatch && !isLocalOnlyCommand) {
      await this.refreshSlashCommandsForPrompt(commandMatch[1]);
    }

    // The SDK query stream already terminated (see `queryClosed`); its
    // iterator can't be revived, so enqueueing here would hang on a deferred
    // that never settles. Fail clearly and let the client start fresh.
    if (this.session.queryClosed) {
      throw RequestError.internalError(undefined, SESSION_ENDED_MESSAGE);
    }

    const hasInFlightTurns =
      this.session.activeTurn !== null || this.session.turnQueue.length > 0;

    if (hasInFlightTurns && isSteerMeta(params._meta)) {
      // Fold this message into the turn already running instead of queueing a
      // new turn. promptToClaude tagged it priority:"next" so the SDK delivers
      // it at the next tool-call boundary. Return immediately with a benign
      // end_turn: the in-flight turn (not this call) owns the real stop
      // reason. The client tells steers apart by the request's _meta.steer,
      // not by this value.
      this.session.input.push(userMessage);
      await this.broadcastUserMessage(params);
      return { stopReason: "end_turn" };
    }

    if (!hasInFlightTurns && !isLocalOnlyCommand) {
      // Reconnect the signed-commit server before the turn (guard hook backstops).
      await this.ensureLocalToolsConnected("pre-prompt");
    }

    if (this.session.lastContextWindowSize == null) {
      this.session.lastContextWindowSize = this.getContextWindowForModel(
        this.session.modelId ?? "",
      );
      this.logger.debug("Initial context window size from gateway", {
        modelId: this.session.modelId,
        contextWindowSize: this.session.lastContextWindowSize,
      });
    }

    // Each prompt is a Turn whose deferred the persistent consumer settles
    // once the turn's outcome is known. `prompt()` owns no loop: it enqueues
    // the turn, pushes the user message onto the streaming input, makes sure
    // the consumer is running, and awaits the deferred.
    const turn: Turn = {
      promptUuid,
      isLocalOnlyCommand,
      commandName: commandMatch?.[1],
      broadcast: () => this.broadcastUserMessage(params),
      settled: false,
      resolve: () => {},
      reject: () => {},
    };
    const response = new Promise<PromptResponse>((resolve, reject) => {
      turn.resolve = resolve;
      turn.reject = reject;
    });

    this.session.turnQueue.push(turn);
    this.session.input.push(userMessage);
    this.ensureConsumer(params.sessionId);
    return response;
  }

  /** Lazily start the per-session consumer that drains the SDK query stream
   *  for the session's whole life. Idempotent: only the first `prompt()`
   *  starts it (and refreshSession clears the handle so the next prompt
   *  starts a fresh consumer on the new query). */
  private ensureConsumer(sessionId: string): void {
    const session = this.session;
    if (session.consumer) {
      return;
    }
    // Wake-up channel so cancel() can force the consumer to settle the active
    // turn "cancelled" even when query.next() is wedged and never yields
    // again. The consumer re-arms it after each fire.
    session.cancelController = new AbortController();
    session.consumer = this.runConsumer(session, sessionId);
    session.consumer.catch((error) => {
      this.logger.error("Consumer terminated unexpectedly", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private cancelledResponse(): PromptResponse {
    return {
      stopReason: "cancelled",
      _meta: this.session.interruptReason
        ? { interruptReason: this.session.interruptReason }
        : undefined,
    };
  }

  /** Mark the session's query stream as finished and release its resources.
   *  The iterator can't be revived, so a later prompt() rejects up front with
   *  SESSION_ENDED_MESSAGE rather than restarting a consumer on the exhausted
   *  stream. Idempotent. */
  private closeQueryStream(session: Session): void {
    session.queryClosed = true;
    session.consumer = undefined;
    if (session.forceCancelTimer) {
      clearTimeout(session.forceCancelTimer);
      session.forceCancelTimer = undefined;
    }
    session.cancelController = undefined;
    session.settingsManager.dispose();
    session.input.end();
    this.toolUseStreamCache.clear();
  }

  /** The single, long-lived consumer of the SDK query stream for the session.
   *  It forwards every message as ACP `sessionUpdate`s (so background and
   *  between-turn output streams live, not just while a prompt is awaiting)
   *  and settles each Turn's deferred when that turn ends. Replaces the
   *  per-prompt message loop. */
  private async runConsumer(
    session: Session,
    sessionId: string,
  ): Promise<void> {
    // The query/generation this consumer serves. refreshSession swaps the
    // session's query and bumps the generation; a consumer that observes the
    // mismatch exits quietly instead of tearing down the refreshed session.
    const query = session.query;
    const generation = session.queryGeneration;
    const refreshed = () =>
      this.session !== session ||
      session.query !== query ||
      session.queryGeneration !== generation;

    // Per-turn scratch, reset whenever a turn becomes active. Kept as
    // consumer locals (rather than per-Turn fields) because they describe the
    // message currently being processed, which is sequential — exactly one
    // turn is active at a time.
    let lastAssistantTotalUsage: number | null = null;
    let lastRefusalExplanation: string | null = null;
    let lastRefusalCategory: string | null = null;
    let lastStreamUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };
    // Tracks whether we're inside a compaction. The SDK emits the terminal
    // `status` (compact_result success/failed) twice for a single failed
    // compaction, and the two messages are indistinguishable, so we report the
    // outcome only while a compaction is in progress, then clear this. A fresh
    // `compacting` status sets it again, so every distinct compaction (e.g.
    // repeated auto-compactions in a long turn) is still shown.
    let compactionInProgress = false;
    // Stop reason accumulated for the active turn. Reset per turn; read when
    // the turn settles at its terminal result (or at stream end).
    let stopReason: PromptResponse["stopReason"] = "end_turn";

    // Model switches reset session.lastContextWindowSize, so always read the
    // live value instead of caching a copy across turns.
    const windowSize = () =>
      this.session.lastContextWindowSize ??
      this.getContextWindowForModel(this.session.modelId ?? "");

    const supportsTerminalOutput =
      (
        this.clientCapabilities?._meta as
          | ClientCapabilities["_meta"]
          | undefined
      )?.terminal_output === true;

    const context = {
      session,
      sessionId,
      client: this.client,
      toolUseCache: this.toolUseCache,
      emittedToolCalls: this.emittedToolCalls,
      toolUseStreamCache: this.toolUseStreamCache,
      fileContentCache: this.fileContentCache,
      enrichedReadCache: this.enrichedReadCache,
      logger: this.logger,
      supportsTerminalOutput,
      // Consumer-lived on purpose: turn activation can fire mid-message, so
      // the streamed-content record must NOT reset per turn. It is bounded by
      // being cleared at each top-level message_start and again when the
      // consolidated assistant message consumes it.
      streamedAssistantBlocks: { blocks: [] },
    };

    const sessionUsage = (): Usage => {
      const acc = session.accumulatedUsage;
      return {
        inputTokens: acc.inputTokens,
        outputTokens: acc.outputTokens,
        cachedReadTokens: acc.cachedReadTokens,
        cachedWriteTokens: acc.cachedWriteTokens,
        totalTokens:
          acc.inputTokens +
          acc.outputTokens +
          acc.cachedReadTokens +
          acc.cachedWriteTokens,
      };
    };

    const resetTurnScratch = () => {
      lastAssistantTotalUsage = null;
      lastRefusalExplanation = null;
      lastRefusalCategory = null;
      lastStreamUsage = {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      };
      compactionInProgress = false;
      stopReason = "end_turn";
      // sessionResources is intentionally NOT reset — the products list
      // accumulates across the whole session and is deduped, not per-turn.
      session.accumulatedUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
      };
    };

    /** Promote a queued turn to active: it becomes the one output is
     *  attributed to, and its scratch starts fresh. Clears the cancelled flag
     *  so a turn enqueued after a prior cancel isn't treated as cancelled.
     *  Also clears any leftover orphan-skip count: the SDK echoes/runs input
     *  FIFO, so every orphan from a prior cancel has already arrived by the
     *  time a live turn activates — a non-zero remainder means the SDK
     *  dropped a queued turn on interrupt, so the stale count must not skip a
     *  later echo-less result. */
    const activateTurn = async (turn: Turn) => {
      session.activeTurn = turn;
      session.cancelled = false;
      session.interruptReason = undefined;
      session.pendingOrphanResults = 0;
      resetTurnScratch();
      try {
        await turn.broadcast();
      } catch (error) {
        this.logger.warn("Failed to broadcast user message", {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    /** Ensure there is an active turn before a user-turn result that carries
     *  no echo to activate it, by promoting the queue head. Most turns are
     *  activated by their replayed user message before their result, but
     *  local-only commands (e.g. `/context`) and compaction produce a result
     *  with no matching echo. An echo-less result can also be an ORPHAN:
     *  cancel() settles+removes a queued turn whose user message was already
     *  pushed, so the SDK still runs it and emits a result with no uuid to
     *  match. Promoting the head for an orphan would misattribute its stop
     *  reason/usage to an unrelated later prompt; `pendingOrphanResults`
     *  counts exactly how many such orphans are still expected (FIFO — they
     *  arrive before any live turn's result), so those are skipped. */
    const ensureActiveTurn = async () => {
      if (session.activeTurn) {
        return;
      }
      const head = session.turnQueue.find((t) => !t.settled);
      if (!head) {
        return;
      }
      if (session.pendingOrphanResults > 0) {
        session.pendingOrphanResults--;
        return;
      }
      await activateTurn(head);
    };

    /** Settle the active turn's deferred exactly once, disarm the
     *  force-cancel backstop, and drop it from the queue. */
    const settleActive = (result: PromptResponse) => {
      const turn = session.activeTurn;
      if (!turn || turn.settled) {
        return;
      }
      turn.settled = true;
      if (session.forceCancelTimer) {
        clearTimeout(session.forceCancelTimer);
        session.forceCancelTimer = undefined;
      }
      session.turnQueue = session.turnQueue.filter((t) => t !== turn);
      session.activeTurn = null;
      turn.resolve(result);
    };

    /** Reject the active turn (auth required, error result, …) without
     *  tearing down the consumer: the stream continues to idle and later
     *  turns proceed. */
    const failActive = (error: unknown) => {
      if (session.forceCancelTimer) {
        clearTimeout(session.forceCancelTimer);
        session.forceCancelTimer = undefined;
      }
      const turn = session.activeTurn;
      if (!turn || turn.settled) {
        return;
      }
      turn.settled = true;
      session.turnQueue = session.turnQueue.filter((t) => t !== turn);
      session.activeTurn = null;
      // A failed turn may leave partial streaming-input buffers behind;
      // without this they'd collide with the next turn's content-block
      // indices.
      this.toolUseStreamCache.clear();
      turn.reject(error);
    };

    /** Reject every in-flight turn — used when the stream dies. */
    const failAllTurns = (error: unknown) => {
      if (session.forceCancelTimer) {
        clearTimeout(session.forceCancelTimer);
        session.forceCancelTimer = undefined;
      }
      const turns = session.activeTurn
        ? [
            session.activeTurn,
            ...session.turnQueue.filter((t) => t !== session.activeTurn),
          ]
        : [...session.turnQueue];
      session.activeTurn = null;
      session.turnQueue = [];
      this.toolUseStreamCache.clear();
      for (const turn of turns) {
        if (!turn.settled) {
          turn.settled = true;
          turn.reject(error);
        }
      }
    };

    // The wake-up channel cancel() aborts to force the active turn to settle
    // "cancelled" even when query.next() is wedged. Re-armed after each fire
    // so the consumer keeps serving later turns.
    let cancelController = session.cancelController as AbortController;

    try {
      while (true) {
        const nextMessage = query.next();
        const next = await withAbort(nextMessage, cancelController.signal);
        if (next.result === "aborted" || cancelController.signal.aborted) {
          // cancel() woke us. Abandon the in-flight next() (swallowing any
          // later rejection so it can't surface as unhandled) and settle the
          // active turn "cancelled" per the ACP contract. A cancelled or
          // wedged turn may leave partial streaming-input buffers behind.
          void nextMessage.catch((err) =>
            this.logger.warn("in-flight query.next() rejected after cancel", {
              sessionId,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
          settleActive(this.cancelledResponse());
          this.toolUseStreamCache.clear();
          if (refreshed() || session.queryClosed) {
            return;
          }
          cancelController = new AbortController();
          session.cancelController = cancelController;
          continue;
        }
        const { value: message, done } = next.value;

        if (done || !message) {
          if (refreshed()) {
            // refreshSession ended the old input on purpose; the refreshed
            // session owns fresh resources, so exit without touching them.
            return;
          }
          // The stream ended. Settle the turn that was in flight so its
          // prompt() doesn't hang: cancelled if a cancel is pending,
          // otherwise the accumulated outcome.
          settleActive(
            session.cancelled
              ? this.cancelledResponse()
              : { stopReason, usage: sessionUsage() },
          );
          // Queued turns the SDK never started never ran, so reject them
          // rather than reporting a success for a prompt that produced no
          // output.
          for (const queued of [...session.turnQueue]) {
            if (!queued.settled) {
              queued.settled = true;
              queued.reject(
                RequestError.internalError(undefined, SESSION_ENDED_MESSAGE),
              );
            }
          }
          session.turnQueue = [];
          this.closeQueryStream(session);
          return;
        }

        if (
          session.emitRawSDKMessages &&
          shouldEmitRawMessage(session.emitRawSDKMessages, message)
        ) {
          await this.client.extNotification("_claude/sdkMessage", {
            sessionId,
            message: message as Record<string, unknown>,
          });
        }

        switch (message.type) {
          case "system":
            if (message.subtype === "init") {
              // A fresh init (e.g. after reinitialize) can carry an updated
              // Fast mode state; reconcile it with what session creation
              // seeded.
              await this.syncFastModeState(message.fast_mode_state);
            }
            if (message.subtype === "compact_boundary") {
              // Compaction belongs to the user turn even when the result that
              // carries it arrives without an echo (manual /compact).
              await ensureActiveTurn();
              const usedTokens = await withAbort(
                fetchContextUsedTokens(query, this.logger),
                cancelController.signal,
              );
              lastAssistantTotalUsage =
                usedTokens.result === "success" ? (usedTokens.value ?? 0) : 0;
              await this.client.sessionUpdate({
                sessionId,
                update: {
                  sessionUpdate: "usage_update",
                  used: lastAssistantTotalUsage,
                  size: windowSize(),
                },
              });
            }
            if (message.subtype === "commands_changed") {
              session.knownSlashCommands = collectKnownSlashCommands(
                message.commands,
              );
              const available = getAvailableSlashCommands(message.commands);
              await this.client.sessionUpdate({
                sessionId,
                update: {
                  sessionUpdate: "available_commands_update",
                  availableCommands: available,
                },
              });
              this.updateBreakdownCategory(
                "skills",
                estimateSkillsTokens(available),
              );
              break;
            }
            if (message.subtype === "local_command_output") {
              // A local command produced output, so the head turn is live —
              // activate it so the unsupported-command gate can't fire and
              // its result is attributed correctly.
              await ensureActiveTurn();
            }
            if (message.subtype === "status") {
              // The SDK signals manual `/compact` completion with a status
              // message carrying `compact_result`, not the `compact_boundary`
              // message (which only fires when there's content to compact).
              // Gate the user-facing outcome on `compactionInProgress` to
              // dedupe the duplicate terminal status the SDK emits for failed
              // compactions.
              if (message.status === "compacting") {
                compactionInProgress = true;
                // Fall through to handleSystemMessage so the COMPACTING
                // extNotification still fires.
              } else if (
                message.compact_result === "success" &&
                compactionInProgress
              ) {
                compactionInProgress = false;
                await this.client.sessionUpdate({
                  sessionId,
                  update: {
                    sessionUpdate: "agent_message_chunk",
                    content: {
                      type: "text",
                      text: "\n\nCompacting completed.",
                    },
                  },
                });
                // Clear the "Compacting…" spinner. On success a `compact_boundary`
                // usually also clears it, but a no-op success carries none, so
                // signal completion explicitly.
                await this.client.extNotification(
                  POSTHOG_NOTIFICATIONS.STATUS,
                  {
                    sessionId,
                    status: "compacting",
                    isComplete: true,
                  },
                );
                break;
              } else if (
                message.compact_result === "failed" &&
                compactionInProgress
              ) {
                compactionInProgress = false;
                // A failed compaction never emits a `compact_boundary`, so emit a
                // structured failure status: the renderer clears the "Compacting…"
                // spinner and reports the outcome as its own status row (a separator
                // marker in the new thread), not as assistant prose.
                await this.client.extNotification(
                  POSTHOG_NOTIFICATIONS.STATUS,
                  {
                    sessionId,
                    status: "compacting_failed",
                    error: message.compact_error ?? undefined,
                  },
                );
                break;
              }
            }
            if (
              message.subtype === "session_state_changed" &&
              (message as Record<string, unknown>).state === "idle"
            ) {
              if (session.activeTurn) {
                // A non-cancelled turn already settled at its terminal
                // `result`, so a trailing `idle` is just absorbed. Only a
                // cancelled turn relies on `idle`: its `result` is dropped at
                // the `session.cancelled` guard, so it never settles at a
                // result and must settle here.
                if (session.cancelled) {
                  settleActive(this.cancelledResponse());
                }
                // The SDK generates the session title in a background task
                // and persists it to the session file; `idle` is the
                // turn-over signal, so a new title may have landed.
                await this.maybeUpdateSessionTitle(sessionId, session);
                break;
              }
              // The SDK generates the session title in a background task; a
              // turn that settled at its result reaches idle with no active
              // turn, which is still the point a new title may have landed.
              await this.maybeUpdateSessionTitle(sessionId, session);
              // No active turn. If the head turn is an SDK-consumed slash
              // command that produced no output (e.g. /plugin in a
              // non-interactive context), its echo never comes — surface a
              // clear error instead of leaving the prompt hanging. Only fire
              // for commands the SDK does NOT recognize: plugin and skill
              // commands (e.g. /skills-store) produce a fresh user-message
              // echo with a new uuid that the replay match can't see early,
              // so an early idle for them is a race, not a real
              // "unsupported".
              const head = session.turnQueue.find((t) => !t.settled);
              if (
                head?.commandName &&
                session.pendingOrphanResults === 0 &&
                session.knownSlashCommands?.has(head.commandName.slice(1)) !==
                  true
              ) {
                const cmd = head.commandName;
                this.logger.warn(
                  "Slash command produced no output; treating as unsupported",
                  { sessionId, command: cmd },
                );
                await this.client.sessionUpdate({
                  sessionId,
                  update: {
                    sessionUpdate: "agent_message_chunk",
                    content: {
                      type: "text",
                      text: `Unsupported slash command: \`${cmd}\`. PostHog Code does not implement this command.`,
                    },
                  },
                });
                head.settled = true;
                session.turnQueue = session.turnQueue.filter((t) => t !== head);
                head.resolve({ stopReason: "end_turn" });
                break;
              }
              this.logger.debug("Idle without an active turn", {
                sessionId,
                queuedTurns: session.turnQueue.length,
                command: head?.commandName,
              });
              break;
            }
            await handleSystemMessage(message, context);
            break;

          case "result": {
            // Task-notification followups are autonomous work triggered by a
            // task-notification system message, not by the user's prompt.
            // They must not influence the user-turn lifecycle (activation,
            // stop reason, settle), but their cost is real and is still
            // reported below.
            const isTaskNotification =
              (message as { origin?: { kind?: string } }).origin?.kind ===
              "task-notification";

            // Reconcile the Fast mode toggle with the SDK's reported state
            // (e.g. flipped back to `on` once a rate-limit cooldown clears).
            // Gated to user-driven turns like the other side effects below.
            if (!isTaskNotification) {
              await this.syncFastModeState(
                (message as { fast_mode_state?: FastModeState })
                  .fast_mode_state,
              );
            }

            // A user-turn result needs an active turn so its stop reason is
            // attributed and the turn settles. Local-only commands carry no
            // user-message echo to promote them, so promote the queue head
            // here. Promote BEFORE accumulating usage: activation resets the
            // accumulator, so promoting after would discard this result's
            // tokens.
            if (!isTaskNotification) {
              await ensureActiveTurn();
            }

            if (session.cancelled) {
              // The cancelled turn settles at the trailing idle (or via the
              // force-cancel backstop); drop its result so a stale outcome
              // isn't attributed anywhere.
              break;
            }

            if (!isTaskNotification) {
              // Accumulate usage from this result (guard against null from
              // SDK). Skipped for task-notification followups so their
              // tokens can't leak into a later live turn's response usage.
              session.accumulatedUsage.inputTokens +=
                message.usage.input_tokens ?? 0;
              session.accumulatedUsage.outputTokens +=
                message.usage.output_tokens ?? 0;
              session.accumulatedUsage.cachedReadTokens +=
                message.usage.cache_read_input_tokens ?? 0;
              session.accumulatedUsage.cachedWriteTokens +=
                message.usage.cache_creation_input_tokens ?? 0;
            }

            // SDK can underreport context window (e.g. 200k for 1M models).
            // Use SDK value only if it's larger than what gateway reported.
            const contextWindows = Object.values(message.modelUsage).map(
              (m) => m.contextWindow,
            );
            if (contextWindows.length > 0) {
              const sdkContextWindow = Math.min(...contextWindows);
              if (sdkContextWindow > windowSize()) {
                session.lastContextWindowSize = sdkContextWindow;
              }
            }

            session.contextSize = windowSize();
            if (lastAssistantTotalUsage !== null) {
              session.contextUsed = lastAssistantTotalUsage;
            }

            // Send usage_update notification
            if (lastAssistantTotalUsage !== null) {
              await this.client.sessionUpdate({
                sessionId,
                update: {
                  sessionUpdate: "usage_update",
                  used: lastAssistantTotalUsage,
                  size: windowSize(),
                  cost: {
                    amount: message.total_cost_usd,
                    currency: "USD",
                  },
                },
              });
            }

            // `result.usage` is cumulative across the agentic loop; the
            // outermost-model stream snapshot is what's actually resident.
            const breakdownInputTokens =
              lastStreamUsage.input_tokens +
              lastStreamUsage.cache_read_input_tokens +
              lastStreamUsage.cache_creation_input_tokens;
            await this.client.extNotification(
              POSTHOG_NOTIFICATIONS.USAGE_UPDATE,
              {
                sessionId,
                used: {
                  inputTokens: message.usage.input_tokens,
                  outputTokens: message.usage.output_tokens,
                  cachedReadTokens: message.usage.cache_read_input_tokens,
                  cachedWriteTokens: message.usage.cache_creation_input_tokens,
                },
                cost: message.total_cost_usd,
                breakdown: buildBreakdown(
                  session.contextBreakdownBaseline ?? emptyBaseline(),
                  breakdownInputTokens,
                ),
              },
            );

            if (
              (message as { stop_reason?: string }).stop_reason === "refusal"
            ) {
              // The API's stop_details.explanation is integrator-facing prose,
              // so surface the refusal as a structured status row rather than
              // assistant text.
              await this.client.extNotification(POSTHOG_NOTIFICATIONS.STATUS, {
                sessionId,
                status: "refusal",
                ...(lastRefusalExplanation && {
                  explanation: lastRefusalExplanation,
                }),
                ...(lastRefusalCategory && { category: lastRefusalCategory }),
              });
              if (!isTaskNotification) {
                stopReason = "refusal";
                settleActive({ stopReason: "refusal", usage: sessionUsage() });
              }
              break;
            }

            const result = handleResultMessage(message);
            if (result.error) {
              if (!isTaskNotification) {
                failActive(result.error);
              }
              break;
            }

            // Deliver structured output from SDK's native outputFormat
            if (
              message.subtype === "success" &&
              message.structured_output != null &&
              this.options?.onStructuredOutput
            ) {
              await this.options.onStructuredOutput(
                message.structured_output as Record<string, unknown>,
              );
            }

            // For local-only commands, forward the result text to the client
            if (
              session.activeTurn?.isLocalOnlyCommand &&
              !isTaskNotification &&
              message.subtype === "success" &&
              message.result
            ) {
              await this.client.sessionUpdate({
                sessionId,
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: message.result },
                },
              });
            }

            // Settle the user turn at its terminal result so the client
            // unlocks as soon as the answer is done, rather than waiting for
            // the SDK's trailing `idle` (which can lag while background work
            // runs). The consumer keeps draining afterward, absorbing idle
            // and forwarding any background output. settleActive is
            // idempotent, so a duplicate settle attempt is a no-op.
            if (!isTaskNotification) {
              stopReason = result.stopReason ?? "end_turn";
              settleActive({ stopReason, usage: sessionUsage() });
            }
            break;
          }

          case "stream_event": {
            if (
              message.parent_tool_use_id === null &&
              (message.event.type === "message_start" ||
                message.event.type === "message_delta")
            ) {
              if (message.event.type === "message_start") {
                const u = message.event.message.usage;
                lastStreamUsage = {
                  input_tokens: u.input_tokens ?? 0,
                  output_tokens: u.output_tokens ?? 0,
                  cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
                  cache_creation_input_tokens:
                    u.cache_creation_input_tokens ?? 0,
                };
              } else {
                const u = message.event.usage;
                lastStreamUsage = {
                  input_tokens: u.input_tokens ?? lastStreamUsage.input_tokens,
                  output_tokens: u.output_tokens,
                  cache_read_input_tokens:
                    u.cache_read_input_tokens ??
                    lastStreamUsage.cache_read_input_tokens,
                  cache_creation_input_tokens:
                    u.cache_creation_input_tokens ??
                    lastStreamUsage.cache_creation_input_tokens,
                };
              }

              const nextTotal =
                lastStreamUsage.input_tokens +
                lastStreamUsage.output_tokens +
                lastStreamUsage.cache_read_input_tokens +
                lastStreamUsage.cache_creation_input_tokens;

              if (nextTotal !== lastAssistantTotalUsage) {
                lastAssistantTotalUsage = nextTotal;
                await this.client.sessionUpdate({
                  sessionId,
                  update: {
                    sessionUpdate: "usage_update",
                    used: nextTotal,
                    size: windowSize(),
                  },
                });
              }
            }
            await handleStreamEvent(message, context);
            break;
          }

          case "user":
          case "assistant": {
            // A replayed user message echoes a queued turn back in
            // submission order. The first echo promotes that turn to active;
            // if a different turn is still active, it is handed off (settled
            // end_turn) first. Done before the `cancelled` guard so a turn
            // enqueued after a cancel is still promoted — activateTurn()
            // clears the flag. The echo itself is then dropped from the feed
            // (the client already shows it).
            if (message.type === "user" && "uuid" in message && message.uuid) {
              const queued = session.turnQueue.find(
                (t) => t.promptUuid === message.uuid && !t.settled,
              );
              if (queued) {
                // Only (re)activate if this isn't already the active turn —
                // a turn promoted early (e.g. by a result that preceded its
                // echo) must not have its accumulated usage reset by its own
                // echo.
                if (session.activeTurn !== queued) {
                  if (session.activeTurn) {
                    // Hand off the previous turn. If a cancel is pending for
                    // it (its trailing idle hasn't arrived yet), settle it
                    // "cancelled" per the ACP contract rather than
                    // "end_turn".
                    settleActive(
                      session.cancelled
                        ? this.cancelledResponse()
                        : { stopReason: "end_turn", usage: sessionUsage() },
                    );
                  }
                  await activateTurn(queued);
                }
                break;
              }
              if (
                "isReplay" in message &&
                (message as Record<string, unknown>).isReplay
              ) {
                // Unrelated replay (e.g. the echo of an already-settled turn).
                break;
              }
            }

            if (session.cancelled) {
              break;
            }

            // Skip replayed messages that aren't queued prompts
            if (
              "isReplay" in message &&
              (message as Record<string, unknown>).isReplay
            ) {
              break;
            }

            if (message.type === "assistant") {
              const inner = message.message as unknown as {
                stop_reason?: string | null;
                stop_details?: {
                  category?: string | null;
                  explanation?: string | null;
                } | null;
              };
              if (inner.stop_reason === "refusal") {
                lastRefusalExplanation =
                  inner.stop_details?.explanation ?? null;
                lastRefusalCategory = inner.stop_details?.category ?? null;
              }
            }

            // Store latest assistant usage (excluding subagents)
            // Sum all token types as a proxy for post-turn context occupancy:
            // current turn's output will become next turn's input.
            // Note: per the Anthropic API, input_tokens excludes cache tokens —
            // cache_read and cache_creation are reported separately, so summing
            // all four fields is not double-counting.
            if (
              "usage" in message.message &&
              message.parent_tool_use_id === null
            ) {
              const usage = (
                message.message as unknown as Record<string, unknown>
              ).usage as {
                input_tokens: number | null;
                output_tokens: number | null;
                cache_read_input_tokens: number | null;
                cache_creation_input_tokens: number | null;
              };
              lastAssistantTotalUsage =
                (usage.input_tokens ?? 0) +
                (usage.output_tokens ?? 0) +
                (usage.cache_read_input_tokens ?? 0) +
                (usage.cache_creation_input_tokens ?? 0);

              await this.client.sessionUpdate({
                sessionId,
                update: {
                  sessionUpdate: "usage_update",
                  used: lastAssistantTotalUsage,
                  size: windowSize(),
                  cost: null,
                },
              });
            }

            const result = await handleUserAssistantMessage(message, context);
            if (result.error) {
              // Turn-level failure (e.g. auth required): reject the turn but
              // keep consuming — the stream continues to idle and later
              // turns proceed.
              failActive(result.error);
              break;
            }
            if (result.shouldStop) {
              settleActive({ stopReason: "end_turn" });
            }
            break;
          }

          case "tool_progress": {
            await this.client.sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: "tool_call_update",
                toolCallId: message.tool_use_id,
                status: "in_progress",
                _meta: {
                  claudeCode: {
                    toolName: message.tool_name,
                    toolResponse: {
                      elapsedTimeSeconds: message.elapsed_time_seconds,
                    },
                  },
                } satisfies ToolUpdateMeta,
              },
            });
            break;
          }
          case "rate_limit_event": {
            if (lastAssistantTotalUsage !== null) {
              await this.client.sessionUpdate({
                sessionId,
                update: {
                  sessionUpdate: "usage_update",
                  used: lastAssistantTotalUsage,
                  size: windowSize(),
                  _meta: { "_claude/rateLimit": message.rate_limit_info },
                },
              });
            }
            break;
          }
          case "auth_status":
          case "tool_use_summary":
          case "prompt_suggestion":
            break;

          default:
            unreachable(message as never, this.logger);
            break;
        }
      }
      // `while (true)` only exits via the `done` return above or the catch
      // below; there is no normal fall-through.
    } catch (error) {
      // The query stream itself died (a transport/process error surfaced
      // from query.next()). Turn-level failures (auth, error results) are
      // handled inline via failActive and never reach here.
      if (refreshed()) {
        this.logger.debug("Consumer for a refreshed query exiting on error", {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      const msg = error instanceof Error ? error.message : String(error);
      const processDied =
        error instanceof Error &&
        (msg.includes("ProcessTransport") ||
          msg.includes("terminated process") ||
          msg.includes("process exited with") ||
          msg.includes("process terminated by signal") ||
          msg.includes("Failed to write to process stdin"));
      if (processDied) {
        this.logger.error(`Process died: ${msg}`, {
          sessionId: this.sessionId,
        });
        failAllTurns(
          RequestError.internalError(
            { details: msg },
            "The Claude Agent process exited unexpectedly. Please start a new session.",
          ),
        );
      } else {
        this.logger.error("Query stream error", { sessionId, error: msg });
        failAllTurns(error);
      }
      // Either way the query iterator is finished, so release its resources;
      // a later prompt() then rejects up front with SESSION_ENDED_MESSAGE.
      this.closeQueryStream(session);
    }
  }

  // Called by BaseAcpAgent#cancel() to interrupt the session
  protected async interrupt(): Promise<void> {
    const session = this.session;
    // The stream already ended (see closeQueryStream): every in-flight turn
    // was settled when it closed, and there is no live query to interrupt.
    if (session.queryClosed) {
      return;
    }
    session.cancelled = true;

    // Settle queued turns that haven't started yet (no echo seen) right
    // away. Their user messages were already pushed, so the SDK still runs
    // them and emits echo-less results; count those as orphans so
    // ensureActiveTurn doesn't promote a later live turn for them.
    for (const turn of [...session.turnQueue]) {
      if (turn === session.activeTurn || turn.settled) {
        continue;
      }
      turn.settled = true;
      session.turnQueue = session.turnQueue.filter((t) => t !== turn);
      session.pendingOrphanResults += 1;
      turn.resolve(this.cancelledResponse());
    }

    // Force-cancel backstop: if the SDK never yields after interrupt() (e.g.
    // a wedged TaskOutput block), abort the consumer's wake-up channel so
    // the active turn still settles "cancelled".
    if (
      session.activeTurn &&
      session.cancelController &&
      !session.cancelController.signal.aborted &&
      !session.forceCancelTimer
    ) {
      const cancelController = session.cancelController;
      session.forceCancelTimer = setTimeout(() => {
        this.logger.error(
          `Session ${this.sessionId}: cancel floor elapsed without the SDK yielding; forcing "cancelled". The underlying query may still be wedged — a new session may be required.`,
        );
        cancelController.abort();
      }, this.forceCancelGraceMs);
    }

    await session.query.interrupt();
  }

  /**
   * Refresh the session between turns. Currently the only refreshable field
   * is `mcpServers` — a resume-with-new-options reinit that bakes the servers
   * into query() options (preserving conversation history via resume).
   *
   * This is an `extMethod` (request/response), not `extNotification`, so the
   * caller can await completion before sending the next prompt. The sandbox
   * agent-server uses this on pre-prompt TTL checks.
   *
   * Why resume+rebuild instead of query.setMcpServers()?
   * setMcpServers() does NOT always overwrite servers installed by local/plugin
   * config — it can non-deterministically surface either the config-provided
   * server or the plugin-installed one. In the sandbox, repos may have Claude
   * plugins with their own MCPs, and we want the CLI-supplied set to fully win.
   * Passing mcpServers via query() options (as a "managed"/static set) has that
   * overwrite guarantee, so we tear down the current Query and construct a new
   * one with resume.
   *
   * Caller contract: only call REFRESH_SESSION between turns (no prompt in flight).
   */
  async extMethod(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!isMethod(method, POSTHOG_METHODS.REFRESH_SESSION)) {
      throw RequestError.methodNotFound(method);
    }

    // Trust boundary: refresh is only safe when the caller is trusted infra
    // (e.g. the sandbox agent-server). Do not route this method from
    // untrusted clients — parseMcpServers does no URL/command validation.
    if (params.mcpServers === undefined) {
      throw new RequestError(
        -32602,
        "refresh_session requires at least one refreshable field (e.g. mcpServers)",
      );
    }
    if (!Array.isArray(params.mcpServers)) {
      throw new RequestError(
        -32602,
        "refresh_session: mcpServers must be an array",
      );
    }

    const mcpServers = parseMcpServers(
      params as Pick<NewSessionRequest, "mcpServers">,
      this.logger,
    );
    await this.refreshSession(mcpServers);
    return { refreshed: true };
  }

  private async refreshSession(
    mcpServers: Record<string, McpServerConfig>,
  ): Promise<void> {
    const prev = this.session;
    if (prev.activeTurn !== null || prev.turnQueue.length > 0) {
      throw new RequestError(
        -32002,
        "Cannot refresh session while a prompt turn is in flight",
      );
    }
    if (prev.modelId && !supportsMcpInjection(prev.modelId)) {
      throw new RequestError(
        -32002,
        `Model ${prev.modelId} does not support MCP injection; cannot refresh`,
      );
    }

    this.logger.info("Refreshing session with fresh MCP servers", {
      serverCount: Object.keys(mcpServers).length,
      sessionId: this.sessionId,
    });

    // Retire the old consumer before swapping the query: bumping the
    // generation makes its teardown paths exit quietly (no closeQueryStream
    // on the refreshed session), and aborting its wake-up channel unparks it
    // if query.next() is in flight.
    prev.queryGeneration += 1;
    const oldConsumer = prev.consumer;
    prev.consumer = undefined;
    prev.cancelController?.abort();
    prev.cancelController = undefined;

    // Abort FIRST so any stuck in-flight HTTP request unblocks — otherwise
    // interrupt() can deadlock waiting on an API call that never returns.
    // We allocate a fresh controller for the new Query below so aborting
    // the old one doesn't poison it.
    prev.abortController.abort();
    try {
      await prev.query.interrupt();
    } catch (error) {
      this.logger.debug("Ignoring interrupt error during session refresh", {
        sessionId: this.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    prev.input.end();
    if (oldConsumer) {
      // Bounded: a wedged old query must not block the refresh; the parked
      // consumer exits on its own if the old next() ever settles.
      await withTimeout(oldConsumer, 5_000);
    }

    // Reuse every option from the running session; swap mcpServers, re-root
    // identity on `resume` instead of `sessionId`, and give the new Query a
    // fresh AbortController.
    const newAbortController = new AbortController();
    const { sessionId: _drop, ...rest } = prev.queryOptions;

    // Rebuild the in-process ("sdk") server fresh; reusing the prior instance
    // throws "Already connected to a transport" and drops the signed-commit tools.
    const freshInProcess = prev.buildInProcessMcpServers();
    if (Object.keys(freshInProcess).length > 0) {
      this.logger.info("Rebuilt in-process MCP servers on refresh", {
        sessionId: this.sessionId,
        servers: Object.keys(freshInProcess),
      });
    }

    const newOptions: Options = {
      ...rest,
      mcpServers: { ...mcpServers, ...freshInProcess },
      resume: this.sessionId,
      forkSession: false,
      abortController: newAbortController,
      // `rest.model` is the creation-time value; the user may have switched
      // models since, so re-root the new Query on the live session model.
      ...(prev.modelId && { model: toSdkModelId(prev.modelId) }),
    };

    const newInput = new Pushable<SDKUserMessage>();
    const newQuery = query({ prompt: newInput, options: newOptions });

    prev.query = newQuery;
    prev.input = newInput;
    prev.queryOptions = newOptions;
    prev.abortController = newAbortController;

    const result = await withTimeout(
      newQuery.initializationResult(),
      SESSION_VALIDATION_TIMEOUT_MS,
    );
    if (result.result === "timeout") {
      this.terminateQuery(newQuery, newAbortController);
      throw new RequestError(
        -32603,
        `Session refresh timed out after ${SESSION_VALIDATION_TIMEOUT_MS}ms`,
        { sessionId: this.sessionId },
      );
    }

    this.refreshMcpMetadata(newQuery);
  }

  /**
   * Best-effort self-heal: if the in-process signed-commit server is enabled but
   * the live Query reports it disconnected, rebuild a fresh instance and
   * reconnect via setMcpServers. Returns whether the tooling is usable after.
   */
  private async ensureLocalToolsConnected(trigger: string): Promise<boolean> {
    const names = this.session.localToolsServerNames;
    if (names.length === 0) {
      return true;
    }

    const status = await withTimeout(
      this.session.query.mcpServerStatus(),
      MCP_STATUS_TIMEOUT_MS,
    ).catch((error) => {
      this.logger.debug("ensureLocalToolsConnected: status check failed", {
        trigger,
        error: error instanceof Error ? error.message : String(error),
      });
      return { result: "timeout" as const };
    });
    // A slow or failed status RPC must not block the turn; assume healthy.
    if (status.result !== "success") {
      return true;
    }

    const allConnected = names.every((name) =>
      status.value.some((s) => s.name === name && s.status === "connected"),
    );
    if (allConnected) {
      return true;
    }

    const logCtx = { trigger, sessionId: this.sessionId, servers: names };
    this.logger.warn(
      "Signed-commit MCP server unhealthy; reconnecting",
      logCtx,
    );

    try {
      const next = {
        ...externalMcpServers(this.session.queryOptions.mcpServers),
        ...this.session.buildInProcessMcpServers(),
      };
      await this.session.query.setMcpServers(next);
      this.session.queryOptions.mcpServers = next;
      this.refreshMcpMetadata(this.session.query);
      this.logger.info("Reconnected signed-commit MCP server", logCtx);
      return true;
    } catch (error) {
      this.logger.error("Failed to reconnect signed-commit MCP server", {
        ...logCtx,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /** Clear stale MCP tool metadata, then re-fetch it for the new server set. */
  private refreshMcpMetadata(q: Query): void {
    clearMcpToolMetadataCache();
    this.deferBackgroundFetches(q);
  }

  async setSessionMode(
    params: SetSessionModeRequest,
  ): Promise<SetSessionModeResponse> {
    await this.applySessionMode(params.modeId);
    await this.updateConfigOption("mode", params.modeId);
    return {};
  }

  async setSessionConfigOption(
    params: SetSessionConfigOptionRequest,
  ): Promise<SetSessionConfigOptionResponse> {
    const option = this.session.configOptions.find(
      (o) => o.id === params.configId,
    );
    if (!option) {
      throw new Error(`Unknown config option: ${params.configId}`);
    }

    if (typeof params.value !== "string") {
      throw new Error(
        `Invalid value type for config option ${params.configId}`,
      );
    }

    const allValues: { value: string; name?: string; description?: string }[] =
      "options" in option && Array.isArray(option.options)
        ? (option.options as Array<Record<string, unknown>>).flatMap((o) =>
            "options" in o && Array.isArray(o.options)
              ? (o.options as {
                  value: string;
                  name?: string;
                  description?: string;
                }[])
              : [o as { value: string; name?: string; description?: string }],
          )
        : [];
    let validValue = allValues.find((o) => o.value === params.value);

    // For model options, fall back to alias resolution when exact match fails.
    // This lets callers use human-friendly aliases like "opus" or "sonnet"
    // instead of full model IDs like "claude-opus-4-8".
    if (!validValue && params.configId === "model") {
      const resolved = resolveModelPreference(params.value, allValues);
      if (resolved) {
        validValue = allValues.find((o) => o.value === resolved);
      }
    }

    if (!validValue) {
      throw new Error(
        `Invalid value for config option ${params.configId}: ${params.value}`,
      );
    }

    // Use the canonical option value so downstream code always receives the
    // model ID rather than the caller-supplied alias.
    const resolvedValue = validValue.value;

    if (params.configId === "mode") {
      await this.applySessionMode(resolvedValue);
      await this.client.sessionUpdate({
        sessionId: this.sessionId,
        update: {
          sessionUpdate: "current_mode_update",
          currentModeId: resolvedValue,
        },
      });
    } else if (params.configId === "model") {
      const sdkModelId = toSdkModelId(resolvedValue);
      await this.session.query.setModel(sdkModelId);
      this.session.modelId = resolvedValue;
      this.session.lastContextWindowSize =
        this.getContextWindowForModel(resolvedValue);
      this.rebuildEffortConfigOption(resolvedValue);
      // The Fast mode toggle follows the newly selected model: it disappears
      // when the model lacks fast support and reappears (with the retained
      // user intent) when a supporting model is selected again.
      this.rebuildFastModeConfigOption(resolvedValue);
    } else if (params.configId === "effort") {
      const newEffort = resolvedValue as EffortLevel;
      this.session.effort = newEffort;
      this.session.queryOptions.effort = newEffort;
      await this.session.query.applyFlagSettings({
        // @ts-expect-error SDK Settings.effortLevel omits "max" but runtime accepts it
        effortLevel: newEffort,
      });
    } else if (params.configId === "fast") {
      // Apply the SDK flag first so a rejected control request leaves both
      // the session state and the config option untouched (no UI/SDK
      // desync).
      const enabled = resolvedValue === "on";
      await this.session.query.applyFlagSettings({ fastMode: enabled });
      this.session.fastModeEnabled = enabled;
    }

    this.session.configOptions = this.session.configOptions.map((o) =>
      o.id === params.configId && typeof o.currentValue === "string"
        ? { ...o, currentValue: resolvedValue }
        : o,
    );

    await this.client.sessionUpdate({
      sessionId: this.sessionId,
      update: {
        sessionUpdate: "config_option_update",
        configOptions: this.session.configOptions,
      },
    });

    return { configOptions: this.session.configOptions };
  }

  private async updateConfigOption(
    configId: string,
    value: string,
  ): Promise<void> {
    this.session.configOptions = this.session.configOptions.map((o) =>
      o.id === configId && typeof o.currentValue === "string"
        ? { ...o, currentValue: value }
        : o,
    );

    await this.client.sessionUpdate({
      sessionId: this.sessionId,
      update: {
        sessionUpdate: "config_option_update",
        configOptions: this.session.configOptions,
      },
    });

    // Notify the agent-server so its cached permissionMode stays in sync.
    // Without this, cloud sessions that change mode via plan approval or
    // setSessionMode use a stale mode for relay decisions.
    if (configId === "mode") {
      await this.client.sessionUpdate({
        sessionId: this.sessionId,
        update: {
          sessionUpdate: "current_mode_update",
          currentModeId: value,
        },
      });
    }
  }

  private async applySessionMode(modeId: string): Promise<void> {
    if (!CODE_EXECUTION_MODES.includes(modeId as CodeExecutionMode)) {
      throw new Error("Invalid Mode");
    }
    const previousMode = this.session.permissionMode;
    this.session.permissionMode = modeId as CodeExecutionMode;
    if (modeId === "plan" && previousMode !== "plan") {
      this.session.modeBeforePlan = previousMode;
    }
    try {
      await this.session.query.setPermissionMode(modeId as CodeExecutionMode);
    } catch (error) {
      this.session.permissionMode = previousMode;
      if (error instanceof Error) {
        if (!error.message) {
          error.message = "Invalid Mode";
        }
        throw error;
      }
      throw new Error("Invalid Mode");
    }
  }

  private async validateCwd(cwd: string): Promise<void> {
    if (!path.isAbsolute(cwd)) {
      throw RequestError.invalidParams(
        { cwd },
        `\`cwd\` must be an absolute path, but received: ${cwd}`,
      );
    }

    let stats: fs.Stats;
    try {
      stats = await fs.promises.stat(cwd);
    } catch {
      throw RequestError.invalidParams(
        { cwd },
        `\`cwd\` does not exist on the machine running the agent: ${cwd}`,
      );
    }

    if (!stats.isDirectory()) {
      throw RequestError.invalidParams(
        { cwd },
        `\`cwd\` is not a directory: ${cwd}`,
      );
    }
  }

  /**
   * Without this, a timed-out session leaks an orphaned `claude` process that
   * the retry loop then multiplies. Aborting the controller kills the
   * subprocess via the spawn signal; closing the query stops further reads.
   */
  private terminateQuery(sdkQuery: Query, controller: AbortController): void {
    controller.abort();
    try {
      sdkQuery.close();
    } catch {
      // Query may already be closed.
    }
  }

  private async createSession(
    params: {
      cwd: string;
      mcpServers: NewSessionRequest["mcpServers"];
      additionalDirectories?: NewSessionRequest["additionalDirectories"];
      _meta?: unknown;
    },
    creationOpts: {
      resume?: string;
      forkSession?: boolean;
      skipBackgroundFetches?: boolean;
    } = {},
  ): Promise<NewSessionResponse> {
    const { cwd } = params;
    const { resume, forkSession } = creationOpts;

    await this.validateCwd(cwd);

    const isResume = !!resume;

    const meta = params._meta as NewSessionMeta | undefined;
    const taskId = resolveTaskId(meta);
    // Gate signed-commit wiring on cloud-run detection so the desktop (which
    // signs via CommitSaga) is untouched.
    const cloudRun = isCloudRun(meta);
    const effort = meta?.claudeCode?.options?.effort as EffortLevel | undefined;

    // We want to create a new session id unless it is resume,
    // but not resume + forkSession.
    let sessionId: string;
    if (forkSession) {
      sessionId = uuidv7();
    } else if (isResume) {
      sessionId = resume;
    } else {
      sessionId = uuidv7();
    }

    const input = new Pushable<SDKUserMessage>();

    const settingsManager = new SettingsManager(cwd);
    await settingsManager.initialize();

    const earlyModelId =
      settingsManager.getSettings().model || meta?.model || "";

    // Register the in-process general local-tools MCP server. Tools self-gate
    // via the registry (e.g. signed-commit is cloud-only and needs a GH token),
    // so adding a tool needs no change here. In cloud runs `git commit`/`git
    // push` are blocked by the PreToolUse guard (and the sandbox git shim), so
    // the agent commits via the signed-commit tool instead.
    //
    // A closure so refresh/self-heal can rebuild a fresh instance (reusing one
    // throws "Already connected to a transport"). Capture only the fields it
    // needs so the session doesn't pin the whole meta object.
    const baseBranch = meta?.baseBranch;
    const environment = meta?.environment;
    const buildInProcessMcpServers = (): Record<
      string,
      McpSdkServerConfigWithInstance
    > => {
      const server = createLocalToolsMcpServer(
        { cwd, token: resolveGithubToken(), taskId, baseBranch },
        { environment },
      );
      return server ? { [LOCAL_TOOLS_MCP_NAME]: server } : {};
    };

    const initialInProcess = buildInProcessMcpServers();
    const localToolsServerNames = Object.keys(initialInProcess);
    if (localToolsServerNames.length === 0 && cloudRun) {
      this.logger.warn(
        "Cloud run registered no local tools (missing GH_TOKEN/GITHUB_TOKEN?); signed commits unavailable",
      );
    }

    const mcpServers: Record<string, McpServerConfig> = {
      ...(supportsMcpInjection(earlyModelId)
        ? parseMcpServers(params, this.logger)
        : {}),
      ...initialInProcess,
    };

    const systemPrompt = buildSystemPrompt(meta?.systemPrompt);

    if (meta?.mcpToolApprovals) {
      setMcpToolApprovalStates(meta.mcpToolApprovals);
    }

    // Configure structured output via SDK's native outputFormat
    const outputFormat =
      meta?.jsonSchema && this.options?.onStructuredOutput
        ? { type: "json_schema" as const, schema: meta.jsonSchema }
        : undefined;

    this.logger.debug(isResume ? "Resuming session" : "Creating new session", {
      sessionId,
      taskId,
      taskRunId: meta?.taskRunId,
      cwd,
    });

    const permissionMode: CodeExecutionMode =
      meta?.permissionMode &&
      CODE_EXECUTION_MODES.includes(meta.permissionMode as CodeExecutionMode)
        ? (meta.permissionMode as CodeExecutionMode)
        : "default";

    const taskState: TaskState = new Map();
    const options = buildSessionOptions({
      cwd,
      mcpServers,
      permissionMode,
      canUseTool: this.createCanUseTool(sessionId, meta?.allowedDomains),
      logger: this.logger,
      systemPrompt,
      userProvidedOptions: meta?.claudeCode?.options,
      sessionId,
      isResume,
      forkSession,
      additionalDirectories: [
        ...(meta?.claudeCode?.options?.additionalDirectories ?? []),
        // Prefer the official ACP `additionalDirectories` field. Fall back
        // to the legacy `_meta.additionalRoots` extension for clients that
        // haven't been updated yet.
        ...(params.additionalDirectories ?? meta?.additionalRoots ?? []),
      ],
      disableBuiltInTools: meta?.disableBuiltInTools,
      outputFormat,
      settingsManager,
      onModeChange: this.createOnModeChange(),
      onPostHogResourceUsed: this.createOnPostHogResourceUsed(),
      onProcessSpawned: this.options?.onProcessSpawned,
      onProcessExited: this.options?.onProcessExited,
      effort,
      enrichmentDeps: this.enrichment?.deps,
      enrichedReadCache: this.enrichedReadCache,
      cloudMode: cloudRun,
      onEnsureLocalToolsConnected: () =>
        this.ensureLocalToolsConnected("guard-hook"),
      taskState,
      gatewayEnv: this.options?.gatewayEnv,
      onTaskStateChange: async () => {
        await this.client.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "plan",
            entries: taskStateToPlanEntries(taskState),
          },
        });
      },
    });

    // Use the same abort controller that buildSessionOptions gave to the query
    const abortController = options.abortController as AbortController;

    const q = query({ prompt: input, options });

    const session: Session = {
      query: q,
      queryOptions: options,
      buildInProcessMcpServers,
      localToolsServerNames,
      input,
      cancelled: false,
      settingsManager,
      permissionMode,
      abortController,
      accumulatedUsage: {
        inputTokens: 0,
        outputTokens: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
      },
      sessionResources: new Set(),
      effort,
      configOptions: [],
      turnQueue: [],
      activeTurn: null,
      pendingOrphanResults: 0,
      queryGeneration: 0,
      fastModeEnabled: false,
      emitRawSDKMessages: meta?.claudeCode?.emitRawSDKMessages ?? false,
      contextBreakdownBaseline: {
        ...emptyBaseline(),
        systemPrompt: estimateSystemPrompt(systemPrompt),
        rules: estimateRulesTokens(readClaudeMdQuietly(cwd, this.logger)),
      },
      taskState,

      // Custom properties
      cwd,
      notificationHistory: [],
      taskRunId: meta?.taskRunId,
    };
    this.session = session;
    this.sessionId = sessionId;

    if (isResume) {
      // Resume must block on initialization to validate the session is still alive.
      // For stale sessions this throws (e.g. "No conversation found").
      try {
        const result = await withTimeout(
          q.initializationResult(),
          SESSION_VALIDATION_TIMEOUT_MS,
        );
        if (result.result === "timeout") {
          throw new RequestError(
            -32603,
            `Session ${forkSession ? "fork" : "resumption"} timed out after ${SESSION_VALIDATION_TIMEOUT_MS}ms`,
            { sessionId, taskId, taskRunId: meta?.taskRunId },
          );
        }
        session.knownSlashCommands = collectKnownSlashCommands(
          result.value.commands,
        );
        session.fastModeEnabled = fastModeStateEnabled(
          result.value.fast_mode_state,
        );
      } catch (err) {
        settingsManager.dispose();
        this.terminateQuery(q, abortController);
        if (
          err instanceof Error &&
          err.message === "Query closed before response received"
        ) {
          throw RequestError.resourceNotFound(sessionId);
        }
        this.logger.error(
          forkSession ? "Session fork failed" : "Session resumption failed",
          {
            sessionId,
            taskId,
            taskRunId: meta?.taskRunId,
            errorDetail: serializeError(err),
          },
        );
        throw err;
      }
    }

    // Kick off SDK initialization for new sessions so it runs concurrently
    // with the model config fetch below (the gateway REST call is independent).
    const initStartedAt = Date.now();
    const initPromise = !isResume
      ? withTimeout(q.initializationResult(), SESSION_VALIDATION_TIMEOUT_MS)
      : undefined;

    const [rawModelOptions] = await Promise.all([
      this.getModelConfigOptions(
        settingsManager.getSettings().model || meta?.model || undefined,
        this.options?.gatewayEnv?.anthropicBaseUrl,
      ),
      ...(meta?.taskRunId
        ? [
            this.client.extNotification(POSTHOG_NOTIFICATIONS.SDK_SESSION, {
              taskRunId: meta.taskRunId,
              sessionId,
              adapter: "claude",
            }),
          ]
        : []),
    ]);
    const modelConfigMs = Date.now() - initStartedAt;

    // Restrict the model list to the user's `availableModels` allowlist
    // from settings.json so config UI and downstream resolution stay
    // consistent with what the user configured. The Default option is
    // always preserved per the Claude Code docs.
    const settingsAvailableModels =
      settingsManager.getSettings().availableModels;
    const modelOptions = Array.isArray(settingsAvailableModels)
      ? applyAvailableModelsAllowlist(rawModelOptions, settingsAvailableModels)
      : rawModelOptions;

    if (initPromise) {
      try {
        const initResult = await initPromise;
        if (initResult.result === "timeout") {
          throw new RequestError(
            -32603,
            `Session initialization timed out after ${SESSION_VALIDATION_TIMEOUT_MS}ms`,
            { sessionId, taskId, taskRunId: meta?.taskRunId },
          );
        }
        session.knownSlashCommands = collectKnownSlashCommands(
          initResult.value.commands,
        );
        session.fastModeEnabled = fastModeStateEnabled(
          initResult.value.fast_mode_state,
        );
        this.logger.info("Session initialized", {
          sessionId,
          taskId,
          taskRunId: meta?.taskRunId,
          modelConfigMs,
          initMs: Date.now() - initStartedAt,
        });
      } catch (err) {
        settingsManager.dispose();
        this.terminateQuery(q, abortController);
        this.logger.error("Session initialization failed", {
          sessionId,
          taskId,
          taskRunId: meta?.taskRunId,
          modelConfigMs,
          initMs: Date.now() - initStartedAt,
          errorDetail: serializeError(err),
        });
        throw err;
      }
    }

    const resolvedModelId = resolveInitialModelId(modelOptions, [
      settingsManager.getSettings().model,
      meta?.model,
    ]);
    session.modelId = resolvedModelId;
    session.lastContextWindowSize =
      this.getContextWindowForModel(resolvedModelId);

    const resolvedSdkModel = toSdkModelId(resolvedModelId);

    // New sessions start with options.model = DEFAULT_MODEL, so only a
    // non-default pick needs a setModel call. Resumed sessions always need
    // it: the SDK does not carry the model across resume and would silently
    // run its default otherwise.
    if (isResume || resolvedSdkModel !== DEFAULT_MODEL) {
      await this.session.query.setModel(resolvedSdkModel);
    }

    // Keep thinking enabled by default for effort-capable models (see
    // DEFAULT_EFFORT).
    const resolvedEffort = resolveEffortForModel(resolvedModelId, effort);
    if (resolvedEffort && resolvedEffort !== effort) {
      this.session.effort = resolvedEffort;
      this.session.queryOptions.effort = resolvedEffort;
      await this.session.query.applyFlagSettings({
        // @ts-expect-error SDK Settings.effortLevel omits "max" but runtime accepts it
        effortLevel: resolvedEffort,
      });
    }

    if (supports1MContext(resolvedModelId)) {
      options.betas = ["context-1m-2025-08-07"];
    }

    const availableModes = getAvailableModes();
    const modes: SessionModeState = {
      currentModeId: permissionMode,
      availableModes: availableModes.map((mode) => ({
        id: mode.id,
        name: mode.name,
        description: mode.description ?? undefined,
      })),
    };

    const configOptions = this.buildConfigOptions(
      permissionMode,
      modelOptions,
      this.session.effort ?? DEFAULT_EFFORT,
      session.fastModeEnabled,
    );
    session.configOptions = configOptions;

    if (!creationOpts.skipBackgroundFetches) {
      this.deferBackgroundFetches(q);
    }

    return { sessionId, modes, configOptions };
  }

  private createCanUseTool(
    sessionId: string,
    allowedDomains?: string[],
  ): CanUseTool {
    return async (toolName, toolInput, { suggestions, toolUseID, signal }) =>
      canUseTool({
        session: this.session,
        toolName,
        toolInput: toolInput as Record<string, unknown>,
        toolUseID,
        suggestions,
        signal,
        client: this.client,
        sessionId,
        fileContentCache: this.fileContentCache,
        logger: this.logger,
        updateConfigOption: (configId: string, value: string) =>
          this.updateConfigOption(configId, value),
        applySessionMode: (modeId: string) => this.applySessionMode(modeId),
        allowedDomains,
        emittedToolCalls: this.emittedToolCalls,
        supportsTerminalOutput:
          (
            this.clientCapabilities?._meta as
              | ClientCapabilities["_meta"]
              | undefined
          )?.terminal_output === true,
      });
  }

  private createOnModeChange() {
    return async (newMode: CodeExecutionMode) => {
      if (this.session) {
        const previousMode = this.session.permissionMode;
        this.session.permissionMode = newMode;
        if (newMode === "plan" && previousMode !== "plan") {
          this.session.modeBeforePlan = previousMode;
        }
      }
      await this.updateConfigOption("mode", newMode);
    };
  }

  /** Records the PostHog product behind an executed MCP exec `call` and emits
   *  any newly-seen product so the client's persistent list can update live. */
  private createOnPostHogResourceUsed() {
    return (subTool: string, commandText?: string) => {
      // Surface PostHog calls whose domain we don't recognize yet, so the gap
      // can be closed in `DOMAIN_PRODUCT` rather than the call silently
      // surfacing no chip. Deliberately-suppressed admin domains don't log.
      if (isUnclassifiedPostHogSubTool(subTool)) {
        this.logger.debug("Unclassified PostHog MCP sub-tool", { subTool });
      }
      this.recordSessionResources(
        classifyPostHogExecCall(subTool, commandText),
      );
    };
  }

  /** Adds products to the session-wide set and emits any newly-seen ones.
   *  Session-wide dedup: only the first use of a product emits, so the client's
   *  persistent list shows each chip once across all turns. */
  private recordSessionResources(products: PostHogProductId[]): void {
    if (!this.session) return;
    const added = products.filter((p) => !this.session.sessionResources.has(p));
    if (added.length === 0) return;
    for (const product of added) this.session.sessionResources.add(product);
    void this.emitResourcesUsed(added);
  }

  /** Emits newly-seen PostHog products as soon as they're used, so the client
   *  can append them to a persistent, de-duplicated list in real time. */
  private async emitResourcesUsed(added: PostHogProductId[]): Promise<void> {
    const products = added.map((id) => ({ id, label: POSTHOG_PRODUCTS[id] }));
    await this.client.extNotification(POSTHOG_NOTIFICATIONS.RESOURCES_USED, {
      sessionId: this.sessionId,
      products,
    });
  }

  private getExistingSessionState(
    sessionId: string,
  ): NewSessionResponse | null {
    if (this.sessionId !== sessionId || !this.session) return null;

    const availableModes = getAvailableModes();
    const modes: SessionModeState = {
      currentModeId: this.session.permissionMode,
      availableModes: availableModes.map((mode) => ({
        id: mode.id,
        name: mode.name,
        description: mode.description ?? undefined,
      })),
    };

    return {
      sessionId,
      modes,
      configOptions: this.session.configOptions,
    };
  }

  private buildConfigOptions(
    currentModeId: string,
    modelOptions: {
      currentModelId: string;
      options: SessionConfigSelectOption[];
    },
    currentEffort: EffortLevel = DEFAULT_EFFORT,
    fastModeEnabled?: boolean,
  ): SessionConfigOption[] {
    const modeOptions = getAvailableModes().map((mode) => ({
      value: mode.id,
      name: mode.name,
      description: mode.description ?? undefined,
    }));

    const configOptions: SessionConfigOption[] = [
      {
        id: "mode",
        name: "Approval Preset",
        type: "select",
        currentValue: currentModeId,
        options: modeOptions,
        category: "mode" as SessionConfigOptionCategory,
        description:
          "Choose an approval and sandboxing preset for your session",
      },
      {
        id: "model",
        name: "Model",
        type: "select",
        currentValue: modelOptions.currentModelId,
        options: modelOptions.options,
        category: "model" as SessionConfigOptionCategory,
        description: "Choose which model Claude should use",
      },
    ];

    const effortOptions = getEffortOptions(modelOptions.currentModelId);
    if (effortOptions) {
      configOptions.push({
        id: "effort",
        name: "Effort",
        type: "select",
        currentValue: currentEffort,
        options: effortOptions,
        category: "thought_level" as SessionConfigOptionCategory,
        description: "Controls how much effort Claude puts into its response",
      });
    }

    if (supportsFastMode(modelOptions.currentModelId)) {
      configOptions.push(this.fastModeConfigOption(fastModeEnabled ?? false));
    }

    return configOptions;
  }

  private fastModeConfigOption(enabled: boolean): SessionConfigOption {
    return {
      id: "fast",
      name: "Fast mode",
      type: "select",
      currentValue: enabled ? "on" : "off",
      options: [
        { value: "on", name: "On" },
        { value: "off", name: "Off" },
      ],
      description: "Faster responses on supported models",
    };
  }

  /** Add/remove/refresh the Fast mode option for the selected model. The
   *  user's intent (`session.fastModeEnabled`) is retained while the option
   *  is hidden, so it is correct when a supporting model is reselected. */
  private rebuildFastModeConfigOption(modelId: string): void {
    const withoutFast = this.session.configOptions.filter(
      (o) => o.id !== "fast",
    );
    this.session.configOptions = supportsFastMode(modelId)
      ? [
          ...withoutFast,
          this.fastModeConfigOption(this.session.fastModeEnabled),
        ]
      : withoutFast;
  }

  /** Reconcile the session's Fast mode toggle with an SDK-reported
   *  `fast_mode_state` (delivered on `system`/init and on user-turn results).
   *  The SDK can flip fast mode independently of the user — e.g. back to `on`
   *  once a rate-limit `cooldown` clears — so definitive on/off changes are
   *  mirrored into the config option and pushed to the client. When the
   *  current model doesn't surface the option, the reported state reflects
   *  capability rather than intent, so the retained setting is left alone;
   *  `cooldown` is a transient suspension and must not flap the toggle. */
  private async syncFastModeState(
    state: FastModeState | undefined,
  ): Promise<void> {
    if (state === undefined || state === "cooldown") {
      return;
    }
    if (!this.session.configOptions.some((o) => o.id === "fast")) {
      return;
    }
    const enabled = state === "on";
    if (enabled === this.session.fastModeEnabled) {
      return;
    }
    this.session.fastModeEnabled = enabled;
    await this.updateConfigOption("fast", enabled ? "on" : "off");
  }

  /** Read the SDK-maintained title for the session and, if it changed since
   *  the last look, notify the client with a `session_info_update`. The SDK
   *  has no push event for the title it auto-generates in the background, so
   *  it is pulled at turn-end. A missing session file or read error is
   *  non-fatal: the title is best-effort and another turn will retry. */
  private async maybeUpdateSessionTitle(
    sessionId: string,
    session: Session,
  ): Promise<void> {
    let info: Awaited<ReturnType<typeof getSessionInfo>>;
    try {
      info = await getSessionInfo(sessionId, { dir: session.cwd });
    } catch (error) {
      this.logger.warn("Failed to read session info for title update", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    // `customTitle` is a user-set rename; `summary` is the auto-generated
    // title (or first prompt). Prefer the explicit title when present.
    const rawTitle = info?.customTitle ?? info?.summary;
    if (!rawTitle) {
      return;
    }
    const title = sanitizeTitle(rawTitle);
    if (!title || title === session.lastTitle) {
      return;
    }
    session.lastTitle = title;
    await this.client.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "session_info_update",
        title,
        updatedAt: new Date(info?.lastModified ?? Date.now()).toISOString(),
      },
    });
  }

  private rebuildEffortConfigOption(modelId: string): void {
    const effortOptions = getEffortOptions(modelId);
    const existingEffort = this.session.configOptions.find(
      (o) => o.id === "effort",
    );

    if (!effortOptions) {
      this.session.configOptions = this.session.configOptions.filter(
        (o) => o.id !== "effort",
      );
      if (this.session.effort) {
        this.session.effort = undefined;
        this.session.queryOptions.effort = undefined;
        void this.session.query.applyFlagSettings({
          effortLevel: undefined,
        });
      }
      return;
    }

    const rawCurrentValue = existingEffort?.currentValue;
    const currentValue =
      typeof rawCurrentValue === "string" ? rawCurrentValue : DEFAULT_EFFORT;
    const isValidValue = effortOptions.some((o) => o.value === currentValue);
    const resolvedValue = isValidValue ? currentValue : DEFAULT_EFFORT;

    // Set the default when none is chosen yet (see DEFAULT_EFFORT), or re-apply
    // when the prior level is invalid for the newly selected model.
    if (!this.session.effort || resolvedValue !== currentValue) {
      this.session.effort = resolvedValue as EffortLevel;
      this.session.queryOptions.effort = resolvedValue as EffortLevel;
      void this.session.query.applyFlagSettings({
        // @ts-expect-error SDK Settings.effortLevel omits "max" but runtime accepts it
        effortLevel: resolvedValue,
      });
    }

    const effortConfig: SessionConfigOption = {
      id: "effort",
      name: "Effort",
      type: "select",
      currentValue: resolvedValue,
      options: effortOptions,
      category: "thought_level" as SessionConfigOptionCategory,
      description: "Controls how much effort Claude puts into its response",
    };

    if (existingEffort) {
      this.session.configOptions = this.session.configOptions.map((o) =>
        o.id === "effort" ? effortConfig : o,
      );
    } else {
      this.session.configOptions.push(effortConfig);
    }
  }

  private async sendAvailableCommandsUpdate(): Promise<void> {
    const commands = await this.session.query.supportedCommands();
    this.session.knownSlashCommands = collectKnownSlashCommands(commands);
    const available = getAvailableSlashCommands(commands);
    await this.client.sessionUpdate({
      sessionId: this.sessionId,
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: available,
      },
    });
    this.updateBreakdownCategory("skills", estimateSkillsTokens(available));
  }

  private async refreshSlashCommandsForPrompt(command: string): Promise<void> {
    const commandName = command.slice(1);
    if (this.session.knownSlashCommands?.has(commandName)) {
      return;
    }
    if (commandName.includes(":") || commandName.includes("__")) {
      return;
    }

    try {
      await this.session.query.reloadSkills();
      await this.sendAvailableCommandsUpdate();
    } catch (error) {
      this.logger.warn("Failed to refresh slash commands before prompt", {
        sessionId: this.sessionId,
        command,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Update one category of the context-breakdown baseline so the next
   *  `_posthog/usage_update` carries fresher numbers. No-op when the baseline
   *  hasn't been initialized yet (e.g. in a unit-test session). */
  private updateBreakdownCategory(
    key: keyof NonNullable<Session["contextBreakdownBaseline"]>,
    tokens: number,
  ): void {
    if (!this.session?.contextBreakdownBaseline) return;
    if (this.session.contextBreakdownBaseline[key] === tokens) return;
    this.session.contextBreakdownBaseline = {
      ...this.session.contextBreakdownBaseline,
      [key]: tokens,
    };
  }

  /**
   * Rebuild the in-memory taskState from JSONL and push a plan update so the
   * client's plan panel reflects pre-resume tasks. `loadSession` already covers
   * this via the full `replaySessionHistory` notification stream; resume
   * deliberately stays quiet (the client keeps its own message history) so we
   * walk the transcript here for state only.
   */
  private async rehydrateTaskStateFromJsonl(sessionId: string): Promise<void> {
    try {
      const messages = await getSessionMessages(sessionId, {
        dir: this.session.cwd,
      });
      rehydrateTaskState(messages, this.session.taskState);
      if (this.session.taskState.size === 0) return;
      await this.client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "plan",
          entries: taskStateToPlanEntries(this.session.taskState),
        },
      });
    } catch (err) {
      this.logger.warn("Failed to rehydrate task state", {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async replaySessionHistory(sessionId: string): Promise<void> {
    try {
      const messages = await getSessionMessages(sessionId, {
        dir: this.session.cwd,
      });

      const replayContext = {
        session: this.session,
        sessionId,
        client: this.client,
        toolUseCache: this.toolUseCache,
        emittedToolCalls: this.emittedToolCalls,
        toolUseStreamCache: this.toolUseStreamCache,
        fileContentCache: this.fileContentCache,
        enrichedReadCache: this.enrichedReadCache,
        logger: this.logger,
        registerHooks: false,
        isImportReplay: true,
      };

      for (const msg of messages) {
        const sdkMessage = {
          type: msg.type,
          message: msg.message as {
            content: string | Array<{ type: string; text?: string }>;
            role: typeof msg.type;
          },
          parent_tool_use_id: msg.parent_tool_use_id,
        };
        await handleUserAssistantMessage(
          sdkMessage as Parameters<typeof handleUserAssistantMessage>[0],
          replayContext,
        );
      }
    } catch (err) {
      this.logger.warn("Failed to replay session history", {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ================================
  // EXTENSION METHODS
  // ================================

  /**
   * Fire-and-forget: fetch slash commands and MCP tool metadata in parallel.
   * Both populate caches used later — neither is needed to return configOptions.
   */
  private deferBackgroundFetches(q: Query): void {
    Promise.all([
      new Promise<void>((resolve) => setTimeout(resolve, 10)).then(() =>
        this.sendAvailableCommandsUpdate(),
      ),
      fetchMcpToolMetadata(q, this.logger).then(() => {
        this.updateBreakdownCategory(
          "mcp",
          estimateMcpTokens(getCachedMcpTools()),
        );
        const serverNames = getConnectedMcpServerNames();
        if (serverNames.length > 0) {
          this.options?.onMcpServersReady?.(serverNames);
        }
      }),
    ]).catch((err) =>
      this.logger.error("Background fetch failed", { error: err }),
    );
  }

  private async broadcastUserMessage(params: PromptRequest): Promise<void> {
    for (const chunk of params.prompt) {
      const notification = {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "user_message_chunk" as const,
          content: chunk,
        },
      };
      await this.client.sessionUpdate(notification);
      this.appendNotification(params.sessionId, notification);
    }
  }
}
