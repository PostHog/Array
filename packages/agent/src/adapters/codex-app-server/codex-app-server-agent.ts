import type {
  AgentSideConnection,
  ForkSessionRequest,
  ForkSessionResponse,
  InitializeRequest,
  InitializeResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  ResumeSessionRequest,
  ResumeSessionResponse,
  SessionConfigOption,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  StopReason,
} from "@agentclientprotocol/sdk";
import { POSTHOG_NOTIFICATIONS } from "../../acp-extensions";
import { DEFAULT_CODEX_MODEL } from "../../gateway-models";
import type { ProcessSpawnedCallback } from "../../types";
import { Logger } from "../../utils/logger";
import {
  nodeReadableToWebReadable,
  nodeWritableToWebWritable,
} from "../../utils/streams";
import { BaseAcpAgent, type BaseSettingsManager } from "../base-acp-agent";
import {
  buildBreakdown,
  type ContextBreakdownBaseline,
  emptyBaseline,
  estimateTokens,
} from "../claude/context-breakdown";
import {
  AppServerClient,
  type AppServerClientHandlers,
  type AppServerRpc,
} from "./app-server-client";
import { handleServerRequest } from "./approvals";
import {
  type AccumulatedUsage,
  buildSdkSessionParams,
  buildTurnCompleteParams,
  buildUsageBreakdownParams,
} from "./ext-notifications";
import { toCodexInput } from "./input";
import { buildLocalToolsServer, type LocalToolsMeta } from "./local-tools-mcp";
import { mapAppServerNotification, mapHistoryItem } from "./mapping";
import { toCodexMcpServers } from "./mcp-config";
import {
  APP_SERVER_METHODS,
  APP_SERVER_NOTIFICATIONS,
  APP_SERVER_REQUESTS,
} from "./protocol";
import {
  buildConfigOptions,
  DEFAULT_MODE,
  modeApprovalPolicy,
  resolveInitialMode,
} from "./session-config";
import {
  type CodexAppServerProcess,
  type CodexAppServerProcessOptions,
  spawnCodexAppServerProcess,
} from "./spawn";

/**
 * Subset of the host-supplied `_meta` the app-server adapter consumes. The host
 * (agent-server) sets these on `newSession`; see its `clientConnection.newSession`
 * call. `systemPrompt` carries the task instructions, `jsonSchema` constrains the
 * final assistant message for structured output. The remaining fields (taskRunId,
 * taskId/persistence, environment/channelMode, baseBranch) drive the cloud
 * ext-notifications, local-tools gating, and the context-breakdown baseline —
 * mirroring the codex-acp adapter's `NewSessionMeta`.
 */
type AppServerSessionMeta = {
  // The host sends either a plain string or the Claude-style `{ append }` form.
  systemPrompt?: string | { append?: string };
  jsonSchema?: Record<string, unknown> | null;
  /** Initial approval mode the host requests (mapped to a codex mode). */
  permissionMode?: string;
  taskRunId?: string;
  taskId?: string;
  persistence?: { taskId?: string };
  environment?: "local" | "cloud";
  channelMode?: boolean;
  baseBranch?: string;
};

/**
 * The subset of codex's `Thread` the adapter reads: its id, plus the persisted
 * `turns` (each a list of `ThreadItem`s) that `thread/resume` returns for
 * `loadSession` history replay.
 */
type AppServerThread = {
  id?: string;
  turns?: Array<{ items?: Parameters<typeof mapHistoryItem>[1][] }>;
};

// The native app-server owns its own configuration, so there is nothing for the
// host to manage. BaseAcpAgent only calls dispose() on this.
class NoopSettingsManager implements BaseSettingsManager {
  constructor(private cwd: string) {}
  dispose(): void {}
  getCwd(): string {
    return this.cwd;
  }
  async setCwd(cwd: string): Promise<void> {
    this.cwd = cwd;
  }
  async initialize(): Promise<void> {}
}

export interface CodexAppServerAgentOptions {
  processOptions: CodexAppServerProcessOptions;
  /** Model id passed to thread/start. */
  model?: string;
  /** Reasoning effort passed to turn/start. */
  reasoningEffort?: string;
  processCallbacks?: ProcessSpawnedCallback;
  logger?: Logger;
  /**
   * Invoked once per turn with the structured output the agent produced, parsed
   * from the schema-constrained final assistant message. Mirrors the codex-acp
   * adapter's callback so the host's `setTaskRunOutput` contract is unchanged.
   */
  onStructuredOutput?: (output: Record<string, unknown>) => Promise<void>;
  /** Test seam: build the JSON-RPC client (defaults to spawning the process). */
  rpcFactory?: (handlers: AppServerClientHandlers) => AppServerRpc;
}

/**
 * ACP Agent backed by the native Codex `app-server` protocol. Presents the same
 * ACP surface to PostHog Code as the codex-acp adapter, but talks to Codex's own
 * JSON-RPC protocol underneath instead of going through the Zed translation layer.
 *
 * At parity with codex-acp on the adapter surface: lifecycle (initialize,
 * thread/start, turn/start), resume/fork/list, streamed agent + reasoning text,
 * tool-call rendering (command/file-diff/MCP), token usage (+ `_posthog/usage_update`),
 * configOptions/modes (model + effort selectors, `setSessionConfigOption`,
 * `current_mode_update`, mode→approvalPolicy), `available_commands_update` (skills),
 * plan rendering, interrupt, command/file approvals, MCP injection, structured
 * output via native `outputSchema`, image prompt input, steering (turn/steer),
 * the local-tools MCP, richer approvals (AskUserQuestion / elicitation / permission
 * profiles), the cloud ext-notifications (`_posthog/sdk_session`,
 * `_posthog/turn_complete`, usage breakdown), and `loadSession`.
 */
export class CodexAppServerAgent extends BaseAcpAgent {
  readonly adapterName = "codex";
  private readonly rpc: AppServerRpc;
  private readonly proc?: CodexAppServerProcess;
  // Mutable: switchable mid-session via setSessionConfigOption, applied per-turn.
  private model: string;
  private reasoningEffort?: string;
  private mode = DEFAULT_MODE;
  private availableModels: Array<{ id: string; name: string }> = [];
  private availableEfforts: string[] = [];
  private configOptions: SessionConfigOption[] = [];
  private readonly onStructuredOutput?: (
    output: Record<string, unknown>,
  ) => Promise<void>;
  /** Codex-specific guidance injected at spawn time; replayed per-thread. */
  private readonly developerInstructions?: string;
  private threadId?: string;
  /** JSON schema constraining the final message; set per session via `_meta`. */
  private jsonSchema?: Record<string, unknown>;
  /** Final assistant message text for the in-flight turn (structured output). */
  private lastAgentMessage = "";
  /** Maps the host's taskRunId to this session, replayed for cloud notifications. */
  private taskRunId?: string;
  private cwd?: string;
  /** Active turn id from turn/started — the steering precondition + interrupt target. */
  private turnId?: string;
  /**
   * Per-source context baseline (systemPrompt floor + skills/mcp estimates) the
   * usage breakdown is derived from; codex doesn't attribute input tokens.
   */
  private contextBreakdownBaseline: ContextBreakdownBaseline = emptyBaseline();
  /** Latest live input-token count from thread/tokenUsage; feeds the breakdown. */
  private contextUsed?: number;
  /**
   * Latest CUMULATIVE thread token totals from thread/tokenUsage (overwritten
   * latest-wins, since codex reports cumulative `total`). The per-turn usage for
   * `_posthog/turn_complete` is this minus `turnStartUsage` — matching codex-acp,
   * which reports per-turn (not cumulative) totals.
   */
  private threadUsageTotal = {
    inputTokens: 0,
    outputTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
  };
  /** Cumulative thread totals snapshotted at the start of the in-flight turn. */
  private turnStartUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
  };
  private pendingTurn?: {
    resolve: (reason: StopReason) => void;
    reject: (err: Error) => void;
  };
  /** The in-flight turn's completion promise, so steering can await the original. */
  private pendingCompletion?: Promise<StopReason>;

  constructor(
    client: AgentSideConnection,
    options: CodexAppServerAgentOptions,
  ) {
    super(client);
    this.logger =
      options.logger ??
      new Logger({ debug: true, prefix: "[CodexAppServerAgent]" });
    this.model = options.model ?? DEFAULT_CODEX_MODEL;
    this.reasoningEffort = options.reasoningEffort;
    this.onStructuredOutput = options.onStructuredOutput;
    this.developerInstructions = options.processOptions.developerInstructions;

    const handlers: AppServerClientHandlers = {
      logger: this.logger,
      onNotification: (method, params) =>
        this.handleNotification(method, params),
      onRequest: (method, params) => this.handleApproval(method, params),
      onClose: () => this.handleServerClosed(),
    };

    if (options.rpcFactory) {
      this.rpc = options.rpcFactory(handlers);
    } else {
      this.proc = spawnCodexAppServerProcess({
        ...options.processOptions,
        logger: this.logger,
        processCallbacks: options.processCallbacks,
      });
      this.rpc = new AppServerClient(
        {
          readable: nodeReadableToWebReadable(this.proc.stdout),
          writable: nodeWritableToWebWritable(this.proc.stdin),
        },
        handlers,
      );
    }

    this.session = {
      abortController: new AbortController(),
      settingsManager: new NoopSettingsManager(
        options.processOptions.cwd ?? process.cwd(),
      ),
      notificationHistory: [],
      cancelled: false,
    };
  }

  async initialize(request: InitializeRequest): Promise<InitializeResponse> {
    await this.rpc.request(APP_SERVER_METHODS.INITIALIZE, {
      clientInfo: {
        name: "posthog-code",
        title: "PostHog Code",
        version: "0.1.0",
      },
      capabilities: { experimentalApi: false, requestAttestation: false },
    });
    this.rpc.notify(APP_SERVER_NOTIFICATIONS.INITIALIZED, {});
    return {
      protocolVersion: request.protocolVersion,
      agentCapabilities: {
        // Image prompt input now flows through toCodexInput (data URL / remote /
        // localImage). embeddedContext mirrors the Claude adapter's advertisement.
        promptCapabilities: {
          image: true,
          embeddedContext: true,
        },
        // Only http is advertised: toCodexMcpServers translates stdio + http
        // (url) servers. SSE isn't a distinct transport in the codex config we
        // emit, so we don't claim it rather than mistranslate an SSE server into
        // the http shape.
        mcpCapabilities: {
          http: true,
        },
        loadSession: true,
        sessionCapabilities: {
          list: {},
          fork: {},
          resume: {},
          // Extra workspace roots are forwarded to codex as writable_roots.
          additionalDirectories: {},
        },
        _meta: {
          posthog: {
            resumeSession: true,
            // turn/steer folds a mid-turn prompt into the running turn.
            steering: "native",
          },
        },
      },
      agentInfo: {
        name: "codex",
        title: "Codex (app-server)",
        version: "0.1.0",
      },
      authMethods: [],
    };
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const { threadId } = await this.setupThread(
      APP_SERVER_METHODS.THREAD_START,
      {
        cwd: params.cwd,
        mcpServers: params.mcpServers,
        meta: params._meta as AppServerSessionMeta | undefined,
        additionalDirectories: params.additionalDirectories ?? undefined,
      },
    );
    return { sessionId: threadId, configOptions: this.configOptions };
  }

  /** thread/resume — the host calls this on every reconnect to restore a session. */
  async resumeSession(
    params: ResumeSessionRequest,
  ): Promise<ResumeSessionResponse> {
    await this.setupThread(APP_SERVER_METHODS.THREAD_RESUME, {
      cwd: params.cwd,
      mcpServers: params.mcpServers,
      meta: params._meta as AppServerSessionMeta | undefined,
      threadId: params.sessionId,
      additionalDirectories: params.additionalDirectories ?? undefined,
    });
    return { configOptions: this.configOptions };
  }

  /**
   * loadSession — the host re-attaches to an existing thread (e.g. page reload)
   * without starting a new turn. Restores it through the same thread/resume path
   * as resumeSession (model config, configOptions, commands, `_posthog/sdk_session`)
   * and replays the persisted transcript from the resumed thread's turns so the
   * host shows prior history. Returns no `modes` since codex exposes approval
   * modes only through configOptions, not a SessionModeState.
   */
  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    const { thread } = await this.setupThread(
      APP_SERVER_METHODS.THREAD_RESUME,
      {
        cwd: params.cwd,
        mcpServers: params.mcpServers,
        meta: params._meta as AppServerSessionMeta | undefined,
        threadId: params.sessionId,
        additionalDirectories: params.additionalDirectories ?? undefined,
      },
    );
    this.replayHistory(thread);
    return { configOptions: this.configOptions };
  }

  /** thread/fork — branch a new thread from an existing one. */
  async unstable_forkSession(
    params: ForkSessionRequest,
  ): Promise<ForkSessionResponse> {
    const { threadId } = await this.setupThread(
      APP_SERVER_METHODS.THREAD_FORK,
      {
        cwd: params.cwd,
        mcpServers: params.mcpServers,
        meta: params._meta as AppServerSessionMeta | undefined,
        threadId: params.sessionId,
        additionalDirectories: params.additionalDirectories ?? undefined,
      },
    );
    return { sessionId: threadId, configOptions: this.configOptions };
  }

  /**
   * Replay a resumed thread's persisted turns as ACP session updates so a
   * reattaching host renders the prior transcript. Native: the turns come from
   * the `thread/resume` response (codex populates `thread.turns` there), so no
   * extra round-trip — and each item reuses the live `mapHistoryItem` renderer.
   */
  private replayHistory(thread: AppServerThread | undefined): void {
    if (!this.sessionId || !thread?.turns?.length) return;
    for (const turn of thread.turns) {
      for (const item of turn.items ?? []) {
        for (const update of mapHistoryItem(this.sessionId, item)) {
          void this.client.sessionUpdate(update).catch(() => undefined);
        }
      }
    }
  }

  /** thread/list — past sessions for the session picker. */
  async listSessions(
    params: ListSessionsRequest,
  ): Promise<ListSessionsResponse> {
    try {
      const res = await this.rpc.request<{
        data?: Array<{
          id?: string;
          cwd?: string;
          name?: string | null;
          preview?: string;
        }>;
      }>(APP_SERVER_METHODS.THREAD_LIST, { cwd: params.cwd });
      const sessions = (res?.data ?? [])
        .filter((t) => t?.id)
        .map((t) => ({
          sessionId: t.id as string,
          cwd: t.cwd ?? params.cwd ?? "",
          ...(t.name || t.preview
            ? { title: t.name ?? t.preview ?? undefined }
            : {}),
        }));
      return { sessions };
    } catch (err) {
      this.logger.warn("thread/list failed", { error: String(err) });
      return { sessions: [] };
    }
  }

  /**
   * Shared thread setup for start/resume/fork: injects task instructions + MCP
   * servers, opens the thread, loads model config, and emits the configOptions.
   * `threadId` present => resume/fork an existing thread; absent => new thread.
   */
  private async setupThread(
    method: string,
    params: {
      cwd?: string;
      mcpServers?: NewSessionRequest["mcpServers"];
      meta?: AppServerSessionMeta;
      threadId?: string;
      additionalDirectories?: string[];
    },
  ): Promise<{ threadId: string; thread: AppServerThread | undefined }> {
    this.jsonSchema = params.meta?.jsonSchema ?? undefined;
    this.cwd = params.cwd;
    this.taskRunId = params.meta?.taskRunId;
    // Honor the host's initial approval mode (mirrors codex-acp). A non-codex
    // value falls back to the default; setSessionConfigOption can change it later.
    this.mode = resolveInitialMode(params.meta?.permissionMode);
    // Codex doesn't attribute input tokens by source, so seed the breakdown with
    // the always-resident floor + the host's system prompt (mirrors codex-acp's
    // buildCodexBaseline) and let the live contextUsed count fill conversation.
    this.contextBreakdownBaseline = buildBaseline(params.meta);
    // Codex's own guidance (set at spawn) plus the host's task system prompt.
    // The host sends systemPrompt as `string | { append }` and, for codex, ALSO
    // pre-flattens it into developerInstructions — so flatten the {append} form
    // (else it stringifies to "[object Object]") and dedupe identical parts (else
    // the prod prompt is duplicated). Set per-thread; the task prompt is only
    // known here.
    const developerInstructions = [
      ...new Set(
        [
          this.developerInstructions,
          flattenSystemPrompt(params.meta?.systemPrompt),
        ].filter((s): s is string => !!s),
      ),
    ].join("\n\n");
    // Fold the host's MCP servers and the local-tools stdio server into one map
    // — the local-tools server (signed-git etc.) is gated by the same cwd + meta
    // the codex-acp adapter uses, so local/desktop runs without a token get none.
    const localTools = buildLocalToolsServer(
      { cwd: params.cwd },
      this.localToolsMeta(params.meta),
    );
    const mcpServers = toCodexMcpServers([
      ...(params.mcpServers ?? []),
      ...(localTools ? [localTools] : []),
    ]);
    const config = buildThreadConfig(mcpServers, params.additionalDirectories);

    const result = await this.rpc.request<{ thread?: AppServerThread }>(
      method,
      {
        model: this.model,
        cwd: params.cwd,
        ...(params.threadId ? { threadId: params.threadId } : {}),
        ...(developerInstructions ? { developerInstructions } : {}),
        ...(config ? { config } : {}),
      },
    );
    const thread = result?.thread;
    const threadId = thread?.id ?? params.threadId;
    if (!threadId) {
      throw new Error(`codex app-server ${method} returned no thread id`);
    }
    this.threadId = threadId;
    this.sessionId = threadId;
    await this.loadModelConfig();
    this.rebuildConfigOptions();
    this.emitConfigOptions();
    await this.emitAvailableCommands();
    // Map the host's taskRunId to this session so it can resume later. Mirrors
    // the codex-acp adapter; only emitted when the host supplied a taskRunId.
    await this.emitSdkSession();
    this.logger.info("Codex app-server thread ready", {
      method,
      threadId,
      mcpServers: mcpServers ? Object.keys(mcpServers) : [],
      hasOutputSchema: !!this.jsonSchema,
      hasLocalTools: !!localTools,
    });
    return { threadId, thread };
  }

  /** Project the session meta onto the local-tools gate inputs. */
  private localToolsMeta(
    meta: AppServerSessionMeta | undefined,
  ): LocalToolsMeta | undefined {
    if (!meta) return undefined;
    return {
      environment: meta.environment,
      channelMode: meta.channelMode,
      taskId: meta.taskId,
      persistence: meta.persistence,
      baseBranch: meta.baseBranch,
    };
  }

  /** Emit `_posthog/sdk_session` once a thread is ready, when a taskRunId exists. */
  private async emitSdkSession(): Promise<void> {
    if (!this.taskRunId || !this.sessionId) return;
    await this.client
      .extNotification(
        POSTHOG_NOTIFICATIONS.SDK_SESSION,
        buildSdkSessionParams(
          this.sessionId,
          this.taskRunId,
        ) as unknown as Record<string, unknown>,
      )
      .catch((err) =>
        this.logger.warn("sdk_session extNotification failed", err),
      );
  }

  /** Switch model / reasoning effort / approval mode mid-session. */
  async setSessionConfigOption(
    params: SetSessionConfigOptionRequest,
  ): Promise<SetSessionConfigOptionResponse> {
    const { configId } = params as { configId?: string };
    const value = (params as { value?: unknown }).value;
    if (typeof value === "string") {
      if (configId === "model") this.model = value;
      else if (configId === "effort") this.reasoningEffort = value;
      else if (configId === "mode") {
        this.mode = value;
        this.emitCurrentMode(value);
      }
    }
    this.rebuildConfigOptions();
    this.emitConfigOptions();
    return { configOptions: this.configOptions };
  }

  /** codex-acp emits current_mode_update on mode change; mirror it for the host's mode cache. */
  private emitCurrentMode(modeId: string): void {
    if (!this.sessionId) return;
    void this.client
      .sessionUpdate({
        sessionId: this.sessionId,
        update: { sessionUpdate: "current_mode_update", currentModeId: modeId },
      } as unknown as Parameters<AgentSideConnection["sessionUpdate"]>[0])
      .catch(() => undefined);
  }

  /** Populate the model/effort selectors from the app-server's model/list. */
  private async loadModelConfig(): Promise<void> {
    try {
      const res = await this.rpc.request<{ data?: any[] }>(
        APP_SERVER_METHODS.MODEL_LIST,
        {},
      );
      const models = res?.data ?? [];
      this.availableModels = models
        .filter((m) => !m?.hidden)
        .map((m) => ({
          id: m.id ?? m.model,
          name: m.displayName ?? m.id ?? m.model,
        }));
      const current = models.find(
        (m) => m.id === this.model || m.model === this.model,
      );
      this.availableEfforts = (current?.supportedReasoningEfforts ?? [])
        .map((e: any) => e?.reasoningEffort ?? e)
        .filter((e: unknown): e is string => typeof e === "string");
    } catch (err) {
      this.logger.warn("model/list failed; using current model only", {
        error: String(err),
      });
      this.availableModels = [];
      this.availableEfforts = [];
    }
  }

  private rebuildConfigOptions(): void {
    this.configOptions = buildConfigOptions({
      model: this.model,
      effort: this.reasoningEffort,
      models: this.availableModels,
      efforts: this.availableEfforts,
    });
  }

  private emitConfigOptions(): void {
    if (!this.sessionId) return;
    void this.client
      .sessionUpdate({
        sessionId: this.sessionId,
        update: {
          sessionUpdate: "config_option_update",
          configOptions: this.configOptions,
        },
      } as unknown as Parameters<AgentSideConnection["sessionUpdate"]>[0])
      .catch((err) => this.logger.warn("config_option_update failed", err));
  }

  /** skills/list → available_commands_update so the slash-command menu fills. */
  private async emitAvailableCommands(): Promise<void> {
    if (!this.sessionId) return;
    let commands: Array<{ name: string; description: string }> = [];
    try {
      const res = await this.rpc.request<{ data?: Array<{ skills?: any[] }> }>(
        APP_SERVER_METHODS.SKILLS_LIST,
        {},
      );
      commands = (res?.data ?? [])
        .flatMap((entry) => entry?.skills ?? [])
        .filter((s) => s?.name)
        .map((s: any) => ({ name: s.name, description: s.description ?? "" }));
    } catch (err) {
      this.logger.warn("skills/list failed", { error: String(err) });
    }
    void this.client
      .sessionUpdate({
        sessionId: this.sessionId,
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: commands,
        },
      } as unknown as Parameters<AgentSideConnection["sessionUpdate"]>[0])
      .catch(() => undefined);
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    if (!this.threadId) {
      throw new Error("prompt() called before newSession()");
    }
    // Reopen the notification gate for any prompt being processed (fresh or
    // steer), not only the fresh-turn branch below — a prior interrupt may have
    // left session.cancelled set.
    this.session.cancelled = false;
    // Prepend `_meta.prContext` (set by the host on PR-follow-up / Slack runs) to
    // the FORWARDED prompt as a text block — mirroring claude (acp-to-sdk) and
    // codex-acp (prependPrContext). Without it, codex cloud follow-up runs lose
    // the PR-review context. The original prompt (no prefix) is what we echo.
    const prContext = (params._meta as { prContext?: unknown } | undefined)
      ?.prContext;
    const promptBlocks =
      typeof prContext === "string" && prContext.length > 0
        ? [{ type: "text" as const, text: prContext }, ...params.prompt]
        : params.prompt;
    const input = toCodexInput(promptBlocks);
    if (input.length === 0) {
      // Every block was unmappable (audio / malformed image). turn/start
      // requires a non-empty input, so end the turn cleanly instead of sending
      // an empty one the server would reject.
      this.logger.warn("prompt() had no usable input blocks; ending turn");
      return { stopReason: "end_turn" };
    }
    // Count by type (not input.length) since a resource block can fan out to a
    // link + a trailing <context> block — only audio/malformed images drop.
    const dropped = params.prompt.filter(
      (b) =>
        b.type !== "text" &&
        b.type !== "image" &&
        b.type !== "resource" &&
        b.type !== "resource_link",
    ).length;
    if (dropped > 0) {
      this.logger.warn("Dropped non-text/non-image prompt blocks", { dropped });
    }
    // Echo the user prompt so the host's session log/UI shows the user turn —
    // codex doesn't emit one (mirrors codex-acp's broadcastUserMessage). Done
    // for both fresh turns and steering so the folded message still renders.
    this.broadcastUserInput(params.prompt);

    if (this.pendingTurn && this.turnId) {
      // A turn is already running: rather than fail (the codex-acp/Claude
      // behavior is to fold the message in), steer it via turn/steer with the
      // active turnId as the precondition. The existing pendingTurn keeps
      // resolving on the original turn/completed.
      await this.rpc
        .request(APP_SERVER_METHODS.TURN_STEER, {
          threadId: this.threadId,
          input,
          expectedTurnId: this.turnId,
        })
        .catch((err) => this.logger.warn("turn/steer failed", err));
      return { stopReason: await this.pendingTurnCompletion() };
    }
    if (this.pendingTurn) {
      // A turn is pending but we never saw turn/started (no turnId yet), so we
      // can't steer. Fail fast rather than clobber the single pendingTurn slot.
      throw new Error("prompt() called while a turn is already in progress");
    }

    this.lastAgentMessage = "";
    this.resetUsage();
    const completion = new Promise<StopReason>((resolve, reject) => {
      this.pendingTurn = { resolve, reject };
    });
    this.pendingCompletion = completion;
    try {
      const approvalPolicy = modeApprovalPolicy(this.mode);
      await this.rpc.request(APP_SERVER_METHODS.TURN_START, {
        threadId: this.threadId,
        input,
        model: this.model,
        ...(this.reasoningEffort ? { effort: this.reasoningEffort } : {}),
        // Synthesized mode → codex approval policy (applied per-turn since there
        // is no app-server mode RPC). Sandbox stays as spawned.
        ...(approvalPolicy ? { approvalPolicy } : {}),
        // Constrain the final assistant message to the task's schema so it is
        // valid JSON we can parse for structured output (replaces the codex-acp
        // `create_output` MCP, which the native app-server has no need for).
        ...(this.jsonSchema ? { outputSchema: this.jsonSchema } : {}),
      });
      return { stopReason: await completion };
    } finally {
      this.pendingTurn = undefined;
      this.pendingCompletion = undefined;
    }
  }

  /**
   * Echo each user prompt block as a `user_message_chunk` for the host log/UI.
   * Echoes the original ACP blocks (text + image) so an image-only turn still
   * renders, mirroring codex-acp/Claude rather than the text-only codex input.
   */
  private broadcastUserInput(prompt: PromptRequest["prompt"]): void {
    if (!this.sessionId) return;
    for (const block of prompt) {
      if (block.type !== "text" && block.type !== "image") continue;
      void this.client
        .sessionUpdate({
          sessionId: this.sessionId,
          update: {
            sessionUpdate: "user_message_chunk",
            content: block,
          },
        })
        .catch(() => undefined);
    }
  }

  private pendingTurnCompletion(): Promise<StopReason> {
    return this.pendingCompletion ?? Promise.resolve("end_turn");
  }

  private resetUsage(): void {
    // Snapshot the cumulative thread total at turn start; finalizeTurn reports
    // the delta as the per-turn usage. (Cumulative only grows, so the delta is
    // always >= 0, including 0 for a turn that consumes no tokens.)
    this.turnStartUsage = { ...this.threadUsageTotal };
    this.contextUsed = undefined;
  }

  protected async interrupt(): Promise<void> {
    // Tell the server to stop first, then finalize through the shared path so a
    // cancelled turn still emits the cloud notifications (_posthog/turn_complete)
    // the host treats as the idle/queue-dispatch signal — matching codex-acp.
    // finalizeTurn claims the turn idempotently, so the server's later
    // turn/completed(interrupted) is a no-op.
    if (this.threadId) {
      await this.rpc
        .request(APP_SERVER_METHODS.TURN_INTERRUPT, { threadId: this.threadId })
        .catch((err) => this.logger.warn("turn/interrupt failed", err));
    }
    await this.finalizeTurn("cancelled");
  }

  async closeSession(): Promise<void> {
    this.session.abortController.abort();
    this.turnId = undefined;
    this.pendingTurn?.resolve("cancelled");
    this.pendingTurn = undefined;
    this.session.settingsManager.dispose();
    // Close the transport BEFORE killing the process: kill() destroys the
    // stdio streams, so awaiting writer.close()/reader.cancel() afterwards
    // would block on an ack that never arrives. Bounded so cleanup can never
    // hang the caller even if the stream is wedged.
    await Promise.race([
      this.rpc.close().catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]);
    this.proc?.kill();
  }

  private handleNotification(method: string, params: unknown): void {
    if (this.sessionId && !this.session.cancelled) {
      const notification = mapAppServerNotification(
        this.sessionId,
        method,
        params,
      );
      if (notification) {
        void this.client
          .sessionUpdate(notification)
          .catch((err) => this.logger.warn("sessionUpdate failed", err));
        this.appendNotification(this.sessionId, notification);
      }
    }

    if (method === APP_SERVER_NOTIFICATIONS.TURN_STARTED && this.pendingTurn) {
      // Capture the active turn id; it's the precondition turn/steer requires
      // and the target turn/interrupt aborts. Gated on an active turn so a
      // stale/duplicate turn/started can't install a turnId with no turn.
      const id = (params as { turn?: { id?: string } })?.turn?.id;
      if (typeof id === "string") this.turnId = id;
    }

    if (method === APP_SERVER_NOTIFICATIONS.ITEM_COMPLETED) {
      this.captureAgentMessage(params);
    }

    if (method === APP_SERVER_NOTIFICATIONS.TOKEN_USAGE_UPDATED) {
      this.emitUsageExtNotification(params);
    }

    if (method === APP_SERVER_NOTIFICATIONS.TURN_COMPLETED) {
      const status = (params as { turn?: { status?: string } })?.turn?.status;
      void this.finalizeTurn(mapTurnStopReason(status));
    }

    if (method === APP_SERVER_NOTIFICATIONS.ERROR) {
      // A non-retried fatal error: resolve the turn so prompt() returns instead
      // of hanging until the stream closes. (willRetry true → codex recovers.)
      const willRetry = (params as { willRetry?: boolean })?.willRetry;
      if (willRetry === false) {
        this.logger.warn("codex app-server fatal error notification", {
          params,
        });
        void this.finalizeTurn("refusal");
      }
    }
  }

  /** Track the latest assistant message so the final one feeds structured output. */
  private captureAgentMessage(params: unknown): void {
    const item = (params as { item?: { type?: string; text?: string } })?.item;
    if (item?.type === "agentMessage" && typeof item.text === "string") {
      this.lastAgentMessage = item.text;
    }
  }

  /** Mirror codex-acp's `_posthog/usage_update` so the host's token/cost UI fills. */
  private emitUsageExtNotification(params: unknown): void {
    if (!this.sessionId) return;
    const tu = (params as { tokenUsage?: any })?.tokenUsage;
    const total = tu?.total;
    if (!total) return;
    // `total` is the cumulative thread total, so overwrite (latest wins). The
    // per-turn delta is computed against turnStartUsage in finalizeTurn.
    this.threadUsageTotal = {
      inputTokens: total.inputTokens ?? 0,
      outputTokens: total.outputTokens ?? 0,
      cachedReadTokens: total.cachedInputTokens ?? 0,
      cachedWriteTokens: 0,
    };
    // Drives the per-source breakdown's "conversation" bucket on turn complete.
    this.contextUsed = total.inputTokens ?? total.totalTokens;
    void this.client
      .extNotification(POSTHOG_NOTIFICATIONS.USAGE_UPDATE, {
        sessionId: this.sessionId,
        used: total.totalTokens,
        size: tu.modelContextWindow ?? null,
        usage: {
          inputTokens: total.inputTokens,
          outputTokens: total.outputTokens,
          cachedReadTokens: total.cachedInputTokens,
          reasoningTokens: total.reasoningOutputTokens,
          totalTokens: total.totalTokens,
        },
      })
      .catch((err) => this.logger.warn("usage extNotification failed", err));
  }

  /**
   * Parses the schema-constrained final message into structured output and
   * delivers it before resolving the turn, so the host's `setTaskRunOutput`
   * has completed by the time `prompt()` returns.
   */
  private async finalizeTurn(reason: StopReason): Promise<void> {
    // Idempotent: claim the pending turn synchronously (before any await) so a
    // second finalize for the same turn — e.g. an `error` notification racing
    // turn/completed — is a no-op and the structured-output callback + cloud
    // notifications don't double-fire.
    const pending = this.pendingTurn;
    if (!pending) return;
    // Claim the whole turn synchronously (before any await): clear pendingTurn
    // AND turnId, and snapshot the turn-scoped telemetry. Otherwise a steer
    // prompt() or a fresh turn racing into the await window below would see a
    // live turnId with no pendingTurn (misrouting a steer into a new turn) or
    // zero this turn's usage via the next turn's resetUsage().
    this.pendingTurn = undefined;
    this.turnId = undefined;
    const message = this.lastAgentMessage;
    // Per-turn usage = cumulative thread total now − the snapshot at turn start
    // (matches codex-acp's per-turn turn_complete, not a thread-cumulative total).
    const usage = {
      inputTokens:
        this.threadUsageTotal.inputTokens - this.turnStartUsage.inputTokens,
      outputTokens:
        this.threadUsageTotal.outputTokens - this.turnStartUsage.outputTokens,
      cachedReadTokens:
        this.threadUsageTotal.cachedReadTokens -
        this.turnStartUsage.cachedReadTokens,
      cachedWriteTokens:
        this.threadUsageTotal.cachedWriteTokens -
        this.turnStartUsage.cachedWriteTokens,
    };
    const contextUsed = this.contextUsed;

    if (this.jsonSchema && this.onStructuredOutput && message) {
      const parsed = parseStructuredOutput(message);
      if (parsed) {
        try {
          await this.onStructuredOutput(parsed);
        } catch (err) {
          this.logger.warn("onStructuredOutput callback threw", { error: err });
        }
      } else {
        this.logger.warn(
          "Could not parse structured output from final message",
          {
            preview: message.slice(0, 200),
          },
        );
      }
    }
    await this.emitTurnComplete(reason, usage, contextUsed);
    pending.resolve(reason);
  }

  /**
   * Emit the cloud per-turn notifications, mirroring codex-acp's runPrompt:
   * `_posthog/turn_complete` (only with a taskRunId — it's a task-tracking
   * signal) plus the `_posthog/usage_update` breakdown variant (always, so local
   * sessions get the ContextBreakdownPopover too).
   */
  private async emitTurnComplete(
    reason: StopReason,
    usage: AccumulatedUsage,
    contextUsed: number | undefined,
  ): Promise<void> {
    if (!this.sessionId) return;
    if (this.taskRunId) {
      await this.client
        .extNotification(
          POSTHOG_NOTIFICATIONS.TURN_COMPLETE,
          buildTurnCompleteParams(
            this.sessionId,
            reason,
            usage,
          ) as unknown as Record<string, unknown>,
        )
        .catch((err) =>
          this.logger.warn("turn_complete extNotification failed", err),
        );
    }
    if (contextUsed !== undefined) {
      await this.client
        .extNotification(
          POSTHOG_NOTIFICATIONS.USAGE_UPDATE,
          buildUsageBreakdownParams(
            this.sessionId,
            this.contextBreakdownBaseline,
            contextUsed,
          ) as unknown as Record<string, unknown>,
        )
        .catch((err) =>
          this.logger.warn("usage breakdown extNotification failed", err),
        );
    }
  }

  private handleServerClosed(): void {
    this.pendingTurn?.reject(
      new Error("codex app-server exited before the turn completed"),
    );
    this.pendingTurn = undefined;
  }

  /**
   * Server-initiated requests. The two simple approvals resolve to a
   * `{ decision }` envelope (codex's `CommandExecutionRequestApprovalResponse` /
   * `FileChangeRequestApprovalResponse` — a bare string is rejected); the richer
   * requests (AskUserQuestion / permission profile / MCP elicitation) carry
   * distinct typed response objects and are delegated to `handleServerRequest`.
   * The AppServerClient sends whatever we return straight back as the JSON-RPC
   * result.
   */
  private async handleApproval(
    method: string,
    params: unknown,
  ): Promise<unknown> {
    const richer = await handleServerRequest(method, params, this.client, {
      sessionId: this.sessionId,
      logger: this.logger,
    });
    if (richer.handled) {
      return richer.response;
    }
    if (
      method !== APP_SERVER_REQUESTS.COMMAND_APPROVAL &&
      method !== APP_SERVER_REQUESTS.FILE_CHANGE_APPROVAL
    ) {
      this.logger.warn("Unrecognized server request; declining", { method });
      return { decision: "decline" };
    }
    const detail = params as { itemId?: string; command?: string };
    const title =
      detail.command ??
      (method === APP_SERVER_REQUESTS.FILE_CHANGE_APPROVAL
        ? "Apply file changes"
        : "Run command");
    try {
      const response = await this.client.requestPermission({
        sessionId: this.sessionId,
        toolCall: { toolCallId: detail.itemId ?? "codex-approval", title },
        options: [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          { optionId: "reject", name: "Reject", kind: "reject_once" },
        ],
      });
      if (
        response.outcome.outcome === "selected" &&
        response.outcome.optionId === "allow"
      ) {
        return { decision: "accept" };
      }
      if (response.outcome.outcome === "cancelled") {
        return { decision: "cancel" };
      }
      return { decision: "decline" };
    } catch (err) {
      this.logger.warn("requestPermission failed; declining", err);
      return { decision: "decline" };
    }
  }
}

// codex-rs/protocol/src/protocol.rs BASELINE_TOKENS — the always-resident floor
// (MCP schemas, skills, preset prompt) we can't attribute per-source. Matches
// the codex-acp adapter's CODEX_BASELINE_TOKENS so the breakdown agrees across
// transports.
const CODEX_BASELINE_TOKENS = 12000;

/**
 * codex `TurnStatus` → ACP `StopReason`. `interrupted` is a cancel (not a clean
 * end), `failed` surfaces as a refusal; `completed`/unknown end the turn.
 */
function mapTurnStopReason(status: string | undefined): StopReason {
  if (status === "interrupted") return "cancelled";
  if (status === "failed") return "refusal";
  return "end_turn";
}

/**
 * The codex `thread/start` / `thread/resume` `config` override map (the JSON form
 * of `-c key=value`). Folds in the host MCP servers and — mirroring the codex-acp
 * `-c sandbox_workspace_write.writable_roots=[...]` spawn arg — makes any extra
 * workspace roots writable. Returns undefined when there is nothing to override.
 */
function buildThreadConfig(
  mcpServers: ReturnType<typeof toCodexMcpServers>,
  additionalDirectories: string[] | undefined,
): Record<string, unknown> | undefined {
  const config: Record<string, unknown> = {};
  if (mcpServers) {
    config.mcp_servers = mcpServers;
  }
  if (additionalDirectories?.length) {
    config.sandbox_workspace_write = { writable_roots: additionalDirectories };
  }
  return Object.keys(config).length > 0 ? config : undefined;
}

/**
 * Seed the context-breakdown baseline with the resident floor plus the host's
 * system prompt, mirroring codex-acp's buildCodexBaseline. The live contextUsed
 * count fills the conversation bucket once the turn produces token usage.
 */
function buildBaseline(
  meta: AppServerSessionMeta | undefined,
): ContextBreakdownBaseline {
  const baseline = emptyBaseline();
  baseline.systemPrompt =
    CODEX_BASELINE_TOKENS +
    estimateTokens(flattenSystemPrompt(meta?.systemPrompt));
  return baseline;
}

/**
 * The host sends systemPrompt as a plain string OR the Claude-style
 * `{ append }` form. Flatten to the underlying string so it isn't stringified
 * to "[object Object]" when folded into developer_instructions / token estimates.
 */
function flattenSystemPrompt(
  systemPrompt: string | { append?: string } | undefined,
): string | undefined {
  if (typeof systemPrompt === "string") return systemPrompt || undefined;
  if (systemPrompt && typeof systemPrompt.append === "string") {
    return systemPrompt.append || undefined;
  }
  return undefined;
}

/**
 * Parses structured output from the final assistant message. `outputSchema`
 * should make the message pure JSON, but parse defensively (fenced block / first
 * object) so a stray wrapper never throws or drops the result.
 */
function parseStructuredOutput(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1].trim());
  const brace = trimmed.match(/\{[\s\S]*\}/);
  if (brace) candidates.push(brace[0]);

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}
