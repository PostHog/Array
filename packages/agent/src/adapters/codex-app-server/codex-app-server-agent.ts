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
import { mcpToolKey, posthogToolMeta } from "@posthog/shared";
import { POSTHOG_NOTIFICATIONS } from "../../acp-extensions";
import {
  DEFAULT_CODEX_MODEL,
  type GatewayModel,
  isOpenAIModel,
} from "../../gateway-models";
import type { ProcessSpawnedCallback } from "../../types";
import { getReasoningEffortOptions as getCodexReasoningEfforts } from "../codex/models";
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
import {
  type AppServerItem,
  changePaths,
  diffContent,
  mapAppServerNotification,
  mapHistoryItem,
} from "./mapping";
import { toCodexMcpServers } from "./mcp-config";
import {
  APP_SERVER_METHODS,
  APP_SERVER_NOTIFICATIONS,
  APP_SERVER_REQUESTS,
} from "./protocol";
import {
  buildConfigOptions,
  collaborationModeFor,
  DEFAULT_MODE,
  modeApprovalPolicy,
  resolveInitialMode,
  sandboxPolicyFor,
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
  /**
   * Deployment environment from the host `_meta`. Gates the per-turn
   * `sandboxPolicy` mode override: on "cloud" a non-danger sandbox would
   * re-engage the unavailable linux-sandbox and panic, so we leave the spawned
   * danger-full-access in place there.
   */
  private environment?: "local" | "cloud";
  /**
   * In-flight MCP tool calls keyed by item id. Codex has no MCP-specific
   * approval; depending on the tool it surfaces either a command-execution
   * approval (correlated by `itemId`) or — for the PostHog server's `exec` —
   * a generic `mcpServer/elicitation/request` that carries no tool/args. Both
   * paths recover the real server/tool/args from here (see handleApproval).
   * Session-scoped and small (one entry per MCP call).
   */
  private readonly mcpToolCallsByItemId = new Map<
    string,
    { server: string; tool: string; args: unknown }
  >();
  /**
   * The most recently seen MCP tool call. An elicitation approval carries only
   * `serverName` (no itemId), so it correlates to this rather than the map. MCP
   * calls are sequential and an elicitation fires while its call is in flight,
   * so the latest call for the matching server is the right one.
   */
  private lastMcpToolCall?: { server: string; tool: string; args: unknown };
  /** Active turn id from turn/started — the steering precondition + interrupt target. */
  private turnId?: string;
  /**
   * Turn ids we've interrupted. After a real interrupt codex emits a late
   * turn/completed(interrupted) for the cancelled turn; if a follow-up turn is
   * already running, that stale completion would otherwise finalize it as
   * cancelled. We drop the completion for any id in here (once).
   */
  private readonly cancelledTurnIds = new Set<string>();
  /**
   * Per-source context baseline (systemPrompt floor + skills/mcp estimates) the
   * usage breakdown is derived from; codex doesn't attribute input tokens.
   */
  private contextBreakdownBaseline: ContextBreakdownBaseline = emptyBaseline();
  /**
   * Latest live context occupancy — the most recent turn's input tokens
   * (`tokenUsage.last`, not the cumulative `total`); feeds the breakdown.
   */
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
      // Opt into codex's experimental API surface. Experimental fields are
      // additive (unknown ones are ignored), so the adapter's known
      // methods/notifications are unaffected; we keep it on so experimental
      // turn/start fields are honored rather than silently dropped.
      capabilities: { experimentalApi: true, requestAttestation: false },
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
    this.environment = params.meta?.environment;
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
        // collaborationMode rides the next turn/start (see prompt()), so nothing
        // to push here — the switch takes effect on the next turn.
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

  /**
   * codex's collaboration mode for this turn, sent as the `turn/start`
   * `collaborationMode` field — `plan` unlocks plan proposals + request_user_input;
   * `default` is the normal coding mode. Sent on EVERY turn (not just Plan):
   * codex's collaboration mode is sticky, so switching Plan→Default must push
   * `default` explicitly to revert — omitting it leaves the thread in Plan. The
   * shape is `{ mode, settings: { model } }` (NOT the verbatim collaborationMode/list
   * output, whose model is null) — model must be a string, so we pass the current
   * model; the turn's own `effort` field handles reasoning.
   */
  private collaborationModeForTurn(): unknown {
    return {
      mode: collaborationModeFor(this.mode),
      settings: { model: this.model },
    };
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
        // model/list comes through the PostHog gateway, which also serves Claude
        // models; a codex session must only offer codex (OpenAI) models, so drop
        // the rest (mirrors the isOpenAIModel filter the creation picker uses).
        .filter((m) => isOpenAIModel(m as unknown as GatewayModel))
        .map((m) => ({
          id: m.id ?? m.model,
          name: m.displayName ?? m.id ?? m.model,
        }));
      const current = models.find(
        (m) => m.id === this.model || m.model === this.model,
      );
      const liveEfforts = (current?.supportedReasoningEfforts ?? [])
        .map((e: any) => e?.reasoningEffort ?? e)
        .filter((e: unknown): e is string => typeof e === "string");
      // The gateway's model/list doesn't populate reasoning efforts, so fall
      // back to the shared codex model→effort map (the same source the creation
      // picker uses) — this surfaces "xhigh" for the gpt-5.5 family instead of
      // capping at "high". If the gateway starts reporting efforts they win.
      this.availableEfforts = liveEfforts.length
        ? liveEfforts
        : getCodexReasoningEfforts(this.model).map((o) => o.value);
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
      mode: this.mode,
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
        // `enabled` is a required boolean in the schema; drop explicitly-disabled
        // skills so the slash-command menu doesn't advertise unusable commands
        // (lenient `!== false` so a malformed payload that omits it still shows).
        .filter((s) => s?.name && s?.enabled !== false)
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
      // turn/steer returns the (possibly rotated) active turnId; refresh
      // this.turnId so a later turn/steer's expectedTurnId precondition and a
      // turn/interrupt still target the live turn (turn/started is not re-emitted
      // for a steer).
      const steerRes = await this.rpc
        .request<{ turnId?: string }>(APP_SERVER_METHODS.TURN_STEER, {
          threadId: this.threadId,
          input,
          expectedTurnId: this.turnId,
        })
        .catch((err) => {
          this.logger.warn("turn/steer failed", err);
          return undefined;
        });
      if (typeof steerRes?.turnId === "string") this.turnId = steerRes.turnId;
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
        // Always request a reasoning summary so the host surfaces thinking; the
        // default "auto" can skip summaries on trivial turns (and raw reasoning
        // is off, so without this the host sees no thought stream at all).
        summary: "detailed",
        // The picker's preset, applied per-turn (no app-server mode RPC):
        // approvalPolicy plus a sandboxPolicy override that actually restricts
        // edits (plan/read-only → readOnly). Skipped on cloud, where a
        // non-danger sandbox re-engages the unavailable linux-sandbox and panics
        // — there it stays at the spawned danger-full-access. Switching the
        // preset takes effect on the next turn.
        ...(approvalPolicy ? { approvalPolicy } : {}),
        // codex's collaboration mode (per-turn field, verified against the
        // binary). Sent every turn — plan unlocks plan proposals +
        // request_user_input, default reverts; codex remembers the last mode, so
        // it must be pushed explicitly to switch back.
        collaborationMode: this.collaborationModeForTurn(),
        ...(this.environment !== "cloud" && sandboxPolicyFor(this.mode)
          ? { sandboxPolicy: sandboxPolicyFor(this.mode) }
          : {}),
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
    // TurnInterruptParams requires BOTH threadId and turnId (the native binary
    // rejects a turnId-less request with -32600, leaving the turn running). The
    // live turnId is captured from turn/started and is still set here —
    // finalizeTurn clears it afterwards. When no turn/started was seen yet there
    // is no server-side turn to abort, so skip the RPC and just finalize.
    if (this.threadId && this.turnId) {
      // Remember it so its late turn/completed(interrupted) is dropped rather
      // than finalizing a follow-up turn.
      this.cancelledTurnIds.add(this.turnId);
      await this.rpc
        .request(APP_SERVER_METHODS.TURN_INTERRUPT, {
          threadId: this.threadId,
          turnId: this.turnId,
        })
        .catch((err) => this.logger.warn("turn/interrupt failed", err));
    }
    await this.finalizeTurn("cancelled");
  }

  async closeSession(): Promise<void> {
    this.session.abortController.abort();
    this.turnId = undefined;
    this.pendingTurn?.resolve("cancelled");
    this.pendingTurn = undefined;
    // Drain any interrupted-turn ids still awaiting their late completion so the
    // set can't accumulate across a long-lived process (each entry is normally
    // removed when that completion arrives, but a dropped one would linger).
    this.cancelledTurnIds.clear();
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

    if (
      method === APP_SERVER_NOTIFICATIONS.ITEM_STARTED ||
      method === APP_SERVER_NOTIFICATIONS.ITEM_COMPLETED
    ) {
      this.captureMcpToolCall(params);
    }

    if (method === APP_SERVER_NOTIFICATIONS.ITEM_COMPLETED) {
      this.captureAgentMessage(params);
    }

    if (method === APP_SERVER_NOTIFICATIONS.TOKEN_USAGE_UPDATED) {
      this.emitUsageExtNotification(params);
    }

    if (method === APP_SERVER_NOTIFICATIONS.TURN_COMPLETED) {
      const turn = (params as { turn?: { id?: string; status?: string } })
        ?.turn;
      // Drop the late completion of a turn we already interrupted so it can't
      // finalize the current (follow-up) turn as cancelled.
      if (turn?.id && this.cancelledTurnIds.delete(turn.id)) return;
      void this.finalizeTurn(mapTurnStopReason(turn?.status));
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

  /** Remember an MCP tool call's server/tool/args so a later approval prompt for
   * the same item can render the real tool instead of codex's generic text. */
  private captureMcpToolCall(params: unknown): void {
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
      const call = {
        server: item.server,
        tool: item.tool,
        args: item.arguments,
      };
      this.mcpToolCallsByItemId.set(item.id, call);
      this.lastMcpToolCall = call;
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
      // codex's app-server TokenUsage.total has no cache-write/creation field
      // (unlike the codex-acp upstream stream), so there is nothing to report —
      // 0 is authoritative here, not a dropped value.
      cachedWriteTokens: 0,
    };
    // Context-window occupancy is the MOST RECENT turn's usage, not the
    // cumulative `total`. codex's ThreadTokenUsage is `{ total, last,
    // modelContextWindow }`; `total` grows every turn, so using it over-reports
    // the window as "filling up" purely from accumulation (e.g. a 189k context
    // shown as 433k). `last` is this turn's breakdown — what actually occupies
    // the window — matching codex's own context-left math. Fall back to `total`
    // only if a build predates `last` (turn one, where last≈total anyway).
    const context = tu.last ?? total;
    // Drives the per-source breakdown's "conversation" bucket on turn complete.
    this.contextUsed = context.inputTokens ?? context.totalTokens;
    void this.client
      .extNotification(POSTHOG_NOTIFICATIONS.USAGE_UPDATE, {
        sessionId: this.sessionId,
        used: context.totalTokens,
        size: tu.modelContextWindow ?? null,
        usage: {
          inputTokens: context.inputTokens,
          outputTokens: context.outputTokens,
          cachedReadTokens: context.cachedInputTokens,
          reasoningTokens: context.reasoningOutputTokens,
          totalTokens: context.totalTokens,
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
      resolveMcpToolCall: (serverName) =>
        this.lastMcpToolCall?.server === serverName
          ? this.lastMcpToolCall
          : undefined,
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
    const isFileChange = method === APP_SERVER_REQUESTS.FILE_CHANGE_APPROVAL;
    const detail = params as {
      itemId?: string;
      command?: string;
      changes?: AppServerItem["changes"];
      available_decisions?: unknown;
    };
    // codex tells us which decisions are valid for THIS approval. The standard
    // accept/decline/cancel always apply; when codex also offers an
    // "approve and remember" decision — a command-prefix exec-policy allowlist
    // ("don't ask again for commands beginning with X") or whole-session approval
    // — surface it as an Allow-always option and echo that exact decision back.
    const availableDecisions = Array.isArray(detail.available_decisions)
      ? detail.available_decisions.filter(
          (d): d is string => typeof d === "string",
        )
      : [];
    const rememberDecision =
      availableDecisions.find((d) => d === "approved_execpolicy_amendment") ??
      availableDecisions.find((d) => d === "approved_for_session");
    const title =
      detail.command ?? (isFileChange ? "Apply file changes" : "Run command");
    const toolCallId = detail.itemId ?? "codex-approval";
    // Codex has no MCP-specific approval; an MCP tool call surfaces as a
    // command-execution approval. When the item is a known MCP call, surface the
    // real server/tool/args so the host renders the proper MCP permission
    // (incl. the PostHog `exec` unwrapping) instead of codex's generic text.
    const mcp = detail.itemId
      ? this.mcpToolCallsByItemId.get(detail.itemId)
      : undefined;
    // Set kind + content so the host routes plain command/file approvals to
    // ExecutePermission / EditPermission (command styling, diff body) rather
    // than the bare DefaultPermission fallback.
    const toolCall = mcp
      ? {
          toolCallId,
          title,
          kind: "other" as const,
          rawInput: mcp.args,
          _meta: posthogToolMeta({
            toolName: mcpToolKey({ server: mcp.server, tool: mcp.tool }),
            mcp: { server: mcp.server, tool: mcp.tool },
          }),
        }
      : isFileChange
        ? {
            toolCallId,
            title,
            kind: "edit" as const,
            content: diffContent(detail.changes),
            locations: changePaths(detail.changes).map((path) => ({ path })),
          }
        : {
            toolCallId,
            title,
            kind: "execute" as const,
            content: detail.command
              ? [
                  {
                    type: "content" as const,
                    content: { type: "text" as const, text: detail.command },
                  },
                ]
              : undefined,
          };
    try {
      const response = await this.client.requestPermission({
        sessionId: this.sessionId,
        toolCall,
        options: [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          ...(rememberDecision
            ? [
                {
                  optionId: "allow_always",
                  name: isFileChange
                    ? "Allow for the rest of this session"
                    : "Allow and don't ask again",
                  kind: "allow_always" as const,
                },
              ]
            : []),
          { optionId: "reject", name: "Reject", kind: "reject_once" },
          {
            optionId: "reject_with_feedback",
            name: "No, and tell Codex what to do differently",
            kind: "reject_once",
            _meta: { customInput: true },
          },
        ],
      });
      if (response.outcome.outcome === "selected") {
        if (response.outcome.optionId === "allow_always" && rememberDecision) {
          // Echo codex's own "approve and remember" decision so it applies the
          // exec-policy/session amendment it proposed in the request.
          return { decision: rememberDecision };
        }
        if (response.outcome.optionId === "allow") {
          return { decision: "accept" };
        }
        if (response.outcome.optionId === "reject_with_feedback") {
          // codex's approval response carries no feedback field, so decline the
          // action and inject the user's guidance into the still-running turn —
          // exactly what codex's TUI does (Denied + a follow-up user message).
          const feedback = (
            response as { _meta?: { customInput?: unknown } }
          )._meta?.customInput;
          if (typeof feedback === "string" && feedback.trim() && this.turnId) {
            void this.rpc
              .request(APP_SERVER_METHODS.TURN_STEER, {
                threadId: this.threadId,
                input: toCodexInput([{ type: "text", text: feedback.trim() }]),
                expectedTurnId: this.turnId,
              })
              .catch((err) =>
                this.logger.warn("turn/steer (reject feedback) failed", err),
              );
          }
          return { decision: "decline" };
        }
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
