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
  RequestPermissionResponse,
  ResumeSessionRequest,
  ResumeSessionResponse,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  StopReason,
} from "@agentclientprotocol/sdk";
import { mcpToolKey, posthogToolMeta } from "@posthog/shared";
import { POSTHOG_NOTIFICATIONS } from "../../acp-extensions";
import { DEFAULT_CODEX_MODEL } from "../../gateway-models";
import type { ProcessSpawnedCallback } from "../../types";
import { ALLOW_BYPASS } from "../../utils/common";
import { Logger } from "../../utils/logger";
import {
  nodeReadableToWebReadable,
  nodeWritableToWebWritable,
} from "../../utils/streams";
import { BaseAcpAgent, type BaseSettingsManager } from "../base-acp-agent";
import {
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
import { type CodexUserInput, toCodexInput } from "./input";
import { buildLocalToolsServer, type LocalToolsMeta } from "./local-tools-mcp";
import {
  type AppServerItem,
  changePaths,
  diffContent,
  mapAppServerNotification,
  mapHistoryItem,
} from "./mapping";
import { toCodexMcpServers } from "./mcp-config";
import { McpManager } from "./mcp-manager";
import {
  APP_SERVER_METHODS,
  APP_SERVER_NOTIFICATIONS,
  APP_SERVER_REQUESTS,
} from "./protocol";
import { type CodexSandboxPolicy, SessionConfigState } from "./session-config";
import {
  type CodexAppServerProcess,
  type CodexAppServerProcessOptions,
  spawnCodexAppServerProcess,
} from "./spawn";
import { parseStructuredOutput } from "./structured-output";
import { TurnController } from "./turn-controller";
import { UsageTracker } from "./usage-tracker";

type AppServerSessionMeta = {
  // The host sends either a plain string or the Claude-style `{ append }` form.
  systemPrompt?: string | { append?: string };
  jsonSchema?: Record<string, unknown> | null;
  permissionMode?: string;
  taskRunId?: string;
  taskId?: string;
  persistence?: { taskId?: string };
  environment?: "local" | "cloud";
  channelMode?: boolean;
  baseBranch?: string;
};

/** The subset of codex's `Thread` the adapter reads: id + persisted `turns` for history replay. */
type AppServerThread = {
  id?: string;
  turns?: Array<{ items?: Parameters<typeof mapHistoryItem>[1][] }>;
};

// The native app-server owns its config; BaseAcpAgent only calls dispose() on this.
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
  model?: string;
  reasoningEffort?: string;
  processCallbacks?: ProcessSpawnedCallback;
  logger?: Logger;
  onStructuredOutput?: (output: Record<string, unknown>) => Promise<void>;
  /** Test seam: build the JSON-RPC client (defaults to spawning the process). */
  rpcFactory?: (handlers: AppServerClientHandlers) => AppServerRpc;
}

/**
 * ACP Agent backed by the native Codex `app-server` JSON-RPC protocol,
 * presenting the ACP surface PostHog Code expects.
 */
export class CodexAppServerAgent extends BaseAcpAgent {
  readonly adapterName = "codex";
  private readonly rpc: AppServerRpc;
  private readonly proc?: CodexAppServerProcess;
  private readonly config: SessionConfigState;
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
  /** True between a contextCompaction item's start and its boundary (dedupes the boundary). */
  private compactionActive = false;
  /** Maps the host's taskRunId to this session, replayed for cloud notifications. */
  private taskRunId?: string;
  /** Deployment environment; on "cloud" a non-danger sandbox would panic, so we skip the override. */
  private environment?: "local" | "cloud";
  private readonly commandOutputs = new Map<string, string>();
  /** Extra writable roots for this session, folded into workspaceWrite sandbox turns. */
  private additionalDirectories?: string[];
  /** The session workspace stays writable when extra roots are applied per turn. */
  private workspaceDirectory?: string;
  /** The in-flight turn's <proposed_plan>, streamed or completed (drives the implement handoff). */
  private planProposal?: { itemId: string; text: string };
  /** Idle signal deferred while the plan handoff keeps this prompt busy. */
  private deferredTurnComplete?: { usage: AccumulatedUsage };
  /** Settles the pending plan-approval race on cancel/close/preempting prompt. */
  private planHandoffCancel?: () => void;
  private readonly mcp = new McpManager();
  private readonly turns = new TurnController();
  private readonly usage = new UsageTracker();

  constructor(
    client: AgentSideConnection,
    options: CodexAppServerAgentOptions,
  ) {
    super(client);
    this.logger =
      options.logger ??
      new Logger({ debug: true, prefix: "[CodexAppServerAgent]" });
    this.config = new SessionConfigState(
      options.model ?? DEFAULT_CODEX_MODEL,
      options.reasoningEffort,
    );
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
      // Opt into codex's experimental API so experimental turn/start fields are honored.
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    this.rpc.notify(APP_SERVER_NOTIFICATIONS.INITIALIZED, {});
    return {
      protocolVersion: request.protocolVersion,
      agentCapabilities: {
        promptCapabilities: {
          image: true,
          embeddedContext: true,
        },
        // Only http: we don't claim SSE rather than mistranslate it into the http shape.
        mcpCapabilities: {
          http: true,
        },
        loadSession: true,
        sessionCapabilities: {
          list: {},
          fork: {},
          resume: {},
          additionalDirectories: {},
        },
        _meta: {
          posthog: {
            resumeSession: true,
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
    return { sessionId: threadId, configOptions: this.config.options };
  }

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
    return { configOptions: this.config.options };
  }

  /** Re-attach to an existing thread without starting a turn: resume it, then replay the transcript. */
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
    return { configOptions: this.config.options };
  }

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
    return { sessionId: threadId, configOptions: this.config.options };
  }

  /** Replay a resumed thread's persisted turns (from the thread/resume response) as session updates. */
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

  /** Shared thread setup for start/resume/fork. `threadId` present => resume/fork; absent => new thread. */
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
    this.taskRunId = params.meta?.taskRunId;
    this.environment = params.meta?.environment;
    this.additionalDirectories = params.additionalDirectories;
    this.workspaceDirectory = params.cwd;
    this.config.setInitialMode(params.meta?.permissionMode);
    // Codex doesn't attribute input tokens by source; the baseline seeds the resident floor + system prompt.
    this.usage.setBaseline(buildBaseline(params.meta));
    // Flatten the {append} form (else "[object Object]") and dedupe identical parts
    // (the host pre-flattens into developerInstructions, so the prod prompt would duplicate).
    const developerInstructions = [
      ...new Set(
        [
          this.developerInstructions,
          flattenSystemPrompt(params.meta?.systemPrompt),
        ].filter((s): s is string => !!s),
      ),
    ].join("\n\n");
    // Degrade gracefully: an unresolvable bundled local-tools script skips it with a
    // warning rather than killing thread setup.
    let localTools: ReturnType<typeof buildLocalToolsServer> = null;
    try {
      localTools = buildLocalToolsServer(
        { cwd: params.cwd },
        this.localToolsMeta(params.meta),
      );
    } catch (err) {
      this.logger.warn(
        "local-tools server unavailable; continuing without it",
        { error: String(err) },
      );
    }
    const mcpServers = toCodexMcpServers([
      ...(params.mcpServers ?? []),
      ...(localTools ? [localTools] : []),
    ]);
    const config = buildThreadConfig(mcpServers, params.additionalDirectories);

    const result = await this.rpc.request<{ thread?: AppServerThread }>(
      method,
      {
        model: this.config.model,
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
    this.emitConfigOptions();
    await this.emitAvailableCommands();
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

  private localToolsMeta(
    meta: AppServerSessionMeta | undefined,
  ): LocalToolsMeta | undefined {
    if (!meta) return undefined;
    return {
      environment: meta.environment,
      channelMode: meta.channelMode,
      taskId: meta.taskId,
      taskRunId: meta.taskRunId,
      persistence: meta.persistence,
      baseBranch: meta.baseBranch,
    };
  }

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

  async setSessionConfigOption(
    params: SetSessionConfigOptionRequest,
  ): Promise<SetSessionConfigOptionResponse> {
    const { configId } = params as { configId?: string };
    const value = (params as { value?: unknown }).value;
    const { modeChanged } = this.config.setOption(configId, value);
    // collaborationMode rides the next turn/start, so a mode switch only needs current_mode_update here.
    if (modeChanged) {
      this.emitCurrentMode(this.config.mode);
      if (this.config.mode !== "plan") this.planHandoffCancel?.();
    }
    this.emitConfigOptions();
    return { configOptions: this.config.options };
  }

  /** Emit current_mode_update on mode change for the host's mode cache. */
  private emitCurrentMode(modeId: string): void {
    if (!this.sessionId) return;
    void this.client
      .sessionUpdate({
        sessionId: this.sessionId,
        update: { sessionUpdate: "current_mode_update", currentModeId: modeId },
      } as unknown as Parameters<AgentSideConnection["sessionUpdate"]>[0])
      .catch(() => undefined);
  }

  private async loadModelConfig(): Promise<void> {
    try {
      const res = await this.rpc.request<{ data?: any[] }>(
        APP_SERVER_METHODS.MODEL_LIST,
        {},
      );
      this.config.loadModels(res?.data ?? []);
    } catch (err) {
      this.logger.warn("model/list failed; using current model only", {
        error: String(err),
      });
      this.config.clearModels();
    }
  }

  private emitConfigOptions(): void {
    if (!this.sessionId) return;
    void this.client
      .sessionUpdate({
        sessionId: this.sessionId,
        update: {
          sessionUpdate: "config_option_update",
          configOptions: this.config.options,
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
        // Drop explicitly-disabled skills; lenient `!== false` so a malformed payload still shows.
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
    // Reopen the notification gate (a prior interrupt may have left session.cancelled set).
    this.session.cancelled = false;
    // A new prompt while the plan handoff awaits approval implicitly declines it:
    // settle the race so the previous prompt() returns and this one owns the turn.
    this.planHandoffCancel?.();
    // Prepend _meta.prContext (host PR-follow-up / Slack runs) to the FORWARDED prompt,
    // else codex cloud follow-ups lose the PR-review context. The echo omits it.
    const prContext = (params._meta as { prContext?: unknown } | undefined)
      ?.prContext;
    const promptBlocks =
      typeof prContext === "string" && prContext.length > 0
        ? [{ type: "text" as const, text: prContext }, ...params.prompt]
        : params.prompt;
    const input = toCodexInput(promptBlocks);
    if (input.length === 0) {
      // turn/start rejects empty input, so end the turn cleanly.
      this.logger.warn("prompt() had no usable input blocks; ending turn");
      return { stopReason: "end_turn" };
    }
    // Count by type (not input.length): a resource block can fan out to multiple blocks.
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
    // Echo the user prompt (codex emits none), for fresh turns and steering alike.
    this.broadcastUserInput(params.prompt);

    if (this.turns.isRunning) {
      // A turn is already running: fold the message in via turn/steer (precondition: the
      // active turnId). Refresh from the response's rotated turnId so a later steer/interrupt
      // still targets the live turn (no turn/started is re-emitted for a steer).
      const steerRes = await this.rpc
        .request<{ turnId?: string }>(APP_SERVER_METHODS.TURN_STEER, {
          threadId: this.threadId,
          input,
          expectedTurnId: this.turns.activeTurnId,
        })
        .catch((err) => {
          this.logger.warn("turn/steer failed", err);
          return undefined;
        });
      this.turns.onSteered(steerRes?.turnId);
      return { stopReason: await this.turns.awaitCompletion() };
    }
    if (this.turns.isPending) {
      // A turn is pending but has no turnId yet, so we can't steer; fail fast.
      throw new Error("prompt() called while a turn is already in progress");
    }

    const stopReason = await this.runTurn(input);
    return { stopReason: await this.maybeOfferPlanImplementation(stopReason) };
  }

  /** Start one codex turn and await its completion. */
  private async runTurn(input: CodexUserInput[]): Promise<StopReason> {
    this.lastAgentMessage = "";
    this.resetUsage();
    this.planProposal = undefined;
    // A new turn owns the idle boundary; its own completion emits the signal.
    this.deferredTurnComplete = undefined;
    const { completion, turn } = this.turns.begin();
    try {
      const approvalPolicy = this.config.approvalPolicy();
      const sandboxPolicy = this.sandboxPolicyForTurn();
      await this.rpc.request(APP_SERVER_METHODS.TURN_START, {
        threadId: this.threadId,
        input,
        model: this.config.model,
        ...(this.config.effort ? { effort: this.config.effort } : {}),
        // Always request a reasoning summary; the default "auto" can skip it on trivial turns.
        summary: "detailed",
        // Picker preset applied per-turn. codex keeps turn overrides for subsequent turns,
        // so every mode sends its full policy — omitting a field would leave the previous
        // mode's value active (e.g. plan's readOnly sandbox bleeding into auto).
        ...(approvalPolicy ? { approvalPolicy } : {}),
        // Pushed every turn — codex remembers the last mode, so switching back from plan must be explicit.
        collaborationMode: this.config.collaborationModeForTurn(),
        // Skipped on cloud, where a non-danger sandbox re-engages the unavailable
        // linux-sandbox and panics; the enclosing docker/Modal sandbox isolates instead.
        ...(this.environment !== "cloud" && sandboxPolicy
          ? { sandboxPolicy }
          : {}),
        // Constrain the final message to the task schema for parseable structured output.
        ...(this.jsonSchema ? { outputSchema: this.jsonSchema } : {}),
      });
      return await completion;
    } finally {
      this.turns.finishPrompt(turn);
    }
  }

  /**
   * codex plan mode finalizes with a <proposed_plan> item and (by design) never
   * asks "should I proceed?" — the client owns the handoff. Mirror the Claude
   * ExitPlanMode flow: offer to implement; on accept switch the mode and run
   * the implementation turn inside the same prompt() call. Plan feedback loops
   * back into another plan turn, whose revised plan prompts again.
   */
  private async maybeOfferPlanImplementation(
    stopReason: StopReason,
  ): Promise<StopReason> {
    let reason = stopReason;
    try {
      while (
        reason === "end_turn" &&
        this.config.mode === "plan" &&
        this.planProposal &&
        !this.session.cancelled
      ) {
        const proposal = this.planProposal;
        this.planProposal = undefined;
        const outcome = await this.requestPlanImplementation(proposal);
        // Re-check after the await: a cancel that raced the response wins, so a
        // late accept can never start implementation on a cancelled prompt.
        if (this.session.cancelled) {
          reason = "cancelled";
          break;
        }
        // A picker change while approval was open owns the mode. Never let a
        // stale approval overwrite it with a broader implementation mode.
        if (this.config.mode !== "plan") break;
        if (outcome.kind === "implement") {
          this.config.setOption("mode", outcome.mode);
          this.emitCurrentMode(outcome.mode);
          this.emitConfigOptions();
          reason = await this.runFollowUpTurn(IMPLEMENT_PLAN_MESSAGE);
          break;
        }
        if (outcome.kind === "feedback") {
          reason = await this.runFollowUpTurn(outcome.feedback);
          continue;
        }
        break;
      }
    } finally {
      await this.flushDeferredTurnComplete(reason);
    }
    return reason;
  }

  /**
   * Emit the idle signal the handoff's plan turn deferred, unless a newer turn
   * took over the boundary (a follow-up turn clears the deferral in runTurn and
   * emits its own completion; a preempting prompt() does the same).
   */
  private async flushDeferredTurnComplete(reason: StopReason): Promise<void> {
    const deferred = this.deferredTurnComplete;
    this.deferredTurnComplete = undefined;
    if (!deferred || this.turns.isPending) return;
    await this.emitTurnCompleteSignal(reason, deferred.usage);
  }

  /** Run an adapter-initiated turn, echoed as a user message like a host prompt. */
  private async runFollowUpTurn(text: string): Promise<StopReason> {
    this.broadcastUserInput([{ type: "text", text }]);
    return this.runTurn(toCodexInput([{ type: "text", text }]));
  }

  /**
   * The ExitPlanMode-style approval: a switch_mode tool call (routes the host
   * to its plan-approval UI) whose option ids are codex mode ids. Cancel or a
   * failed prompt stays in plan mode — never silently start implementing.
   */
  private async requestPlanImplementation(proposal: {
    itemId: string;
    text: string;
  }): Promise<
    | { kind: "implement"; mode: "auto" | "full-access" }
    | { kind: "feedback"; feedback: string }
    | { kind: "stay" }
  > {
    const toolCallId = `${proposal.itemId}:implement`;
    const toolCall = {
      toolCallId,
      title: "Ready to code?",
      kind: "switch_mode",
      content: [
        {
          type: "content" as const,
          content: { type: "text" as const, text: proposal.text },
        },
      ],
      rawInput: { plan: proposal.text },
    };
    const options = [
      {
        optionId: "auto",
        name: 'Yes, and use "auto" mode',
        kind: "allow_always" as const,
      },
      ...(ALLOW_BYPASS
        ? [
            {
              optionId: "full-access",
              name: "Yes, and auto-approve everything",
              kind: "allow_always" as const,
            },
          ]
        : []),
      {
        optionId: "reject_with_feedback",
        name: "No, and tell Codex what to do differently",
        kind: "reject_once" as const,
        _meta: { customInput: true },
      },
    ];
    // Accept only what was offered: a stale or malformed response must not
    // select a mode that was hidden from the approval UI.
    const offered = new Set(options.map((o) => o.optionId));
    const permission = this.client
      .requestPermission({
        sessionId: this.sessionId,
        toolCall,
        options,
      } as unknown as Parameters<AgentSideConnection["requestPermission"]>[0])
      .then(
        (res: RequestPermissionResponse) => ({ failed: false as const, res }),
        (err: unknown) => ({ failed: true as const, err }),
      );
    // Race against cancellation so cancel/close (or a preempting prompt) settles
    // the handoff instead of leaving prompt() pending on UI that may never answer.
    const cancelled = new Promise<undefined>((resolve) => {
      this.planHandoffCancel = () => resolve(undefined);
    });
    const settled = await Promise.race([permission, cancelled]);
    this.planHandoffCancel = undefined;
    if (!settled) return { kind: "stay" };
    if (settled.failed) {
      this.logger.warn("plan implementation prompt failed; staying in plan", {
        error: String(settled.err),
      });
      // Without this the user sees nothing and Plan mode just sits there.
      this.broadcastAgentText(
        'The plan approval prompt could not be shown. Still in Plan mode — switch the mode to Auto and send "Implement the plan." to proceed.',
      );
      return { kind: "stay" };
    }
    const response = settled.res;
    if (this.session.cancelled || response.outcome.outcome !== "selected") {
      return { kind: "stay" };
    }
    const optionId = response.outcome.optionId;
    if (!offered.has(optionId)) return { kind: "stay" };
    if (optionId === "auto") return { kind: "implement", mode: "auto" };
    // Double-gated: only ever offered under ALLOW_BYPASS, and re-checked here.
    if (optionId === "full-access" && ALLOW_BYPASS) {
      return { kind: "implement", mode: "full-access" };
    }
    if (optionId === "reject_with_feedback") {
      const feedback = (response as { _meta?: { customInput?: unknown } })._meta
        ?.customInput;
      if (typeof feedback === "string" && feedback.trim()) {
        return { kind: "feedback", feedback: feedback.trim() };
      }
    }
    return { kind: "stay" };
  }

  /** Emit a plain agent message (user-facing status the model didn't produce). */
  private broadcastAgentText(text: string): void {
    if (!this.sessionId) return;
    void this.client
      .sessionUpdate({
        sessionId: this.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        },
      })
      .catch(() => undefined);
  }

  /** The mode's sandbox with the session's extra writable roots folded into workspaceWrite. */
  private sandboxPolicyForTurn(): CodexSandboxPolicy | undefined {
    const policy = this.config.sandboxPolicy();
    if (
      policy?.type === "workspaceWrite" &&
      this.additionalDirectories?.length
    ) {
      const writableRoots = [
        this.workspaceDirectory,
        ...this.additionalDirectories,
      ].filter((root): root is string => !!root);
      if (writableRoots.length) {
        return { ...policy, writableRoots: [...new Set(writableRoots)] };
      }
    }
    return policy;
  }

  /** Echo each user prompt block (text + image, so an image-only turn still renders) for the host log/UI. */
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

  private resetUsage(): void {
    this.usage.resetForTurn();
  }

  protected async interrupt(): Promise<void> {
    // Settle a pending plan-approval race first so prompt() returns instead of
    // waiting on approval UI that may never answer after a cancel.
    this.planHandoffCancel?.();
    // Stop the server, then finalize through the shared path so a cancelled turn still emits
    // the cloud idle signal (finalizeTurn claims idempotently). turn/interrupt requires BOTH
    // threadId and turnId (else -32600); skip the RPC when no turn started.
    const turnId = this.turns.markInterrupted();
    if (this.threadId && turnId) {
      await this.rpc
        .request(APP_SERVER_METHODS.TURN_INTERRUPT, {
          threadId: this.threadId,
          turnId,
        })
        .catch((err) => this.logger.warn("turn/interrupt failed", err));
    }
    await this.finalizeTurn("cancelled");
  }

  async closeSession(): Promise<void> {
    this.commandOutputs.clear();
    this.session.abortController.abort();
    this.session.cancelled = true;
    this.planHandoffCancel?.();
    this.turns.close("cancelled");
    this.session.settingsManager.dispose();
    // Close the transport BEFORE kill() destroys the stdio streams (else close() blocks on
    // an ack that never arrives). Bounded so cleanup can't hang the caller.
    await Promise.race([
      this.rpc.close().catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]);
    this.proc?.kill();
  }

  private handleNotification(method: string, params: unknown): void {
    const mappedParams = this.withBufferedCommandOutput(method, params);
    if (this.sessionId && !this.session.cancelled) {
      const notification = mapAppServerNotification(
        this.sessionId,
        method,
        mappedParams,
      );
      if (notification) {
        void this.client
          .sessionUpdate(notification)
          .catch((err) => this.logger.warn("sessionUpdate failed", err));
        this.appendNotification(this.sessionId, notification);
      }
    }

    if (method === APP_SERVER_NOTIFICATIONS.TURN_STARTED) {
      // Capture the active turn id (steer precondition / interrupt target).
      this.turns.onStarted((params as { turn?: { id?: string } })?.turn?.id);
    }

    if (method === APP_SERVER_NOTIFICATIONS.ITEM_STARTED) {
      this.mcp.capture(params);
    }
    if (method === APP_SERVER_NOTIFICATIONS.ITEM_COMPLETED) {
      this.mcp.release(params);
    }

    // codex auto-compaction surfaces as a contextCompaction item: item/started → in progress,
    // item/completed → boundary (codex emits no separate thread/compacted; that's a guarded
    // fallback). compactionActive dedupes to one boundary per compaction.
    const isCompactionItem =
      (params as { item?: { type?: string } })?.item?.type ===
      "contextCompaction";
    if (
      method === APP_SERVER_NOTIFICATIONS.ITEM_STARTED &&
      isCompactionItem &&
      !this.compactionActive
    ) {
      this.compactionActive = true;
      this.emitCompactionStarted();
    }
    if (
      this.compactionActive &&
      ((method === APP_SERVER_NOTIFICATIONS.ITEM_COMPLETED &&
        isCompactionItem) ||
        method === APP_SERVER_NOTIFICATIONS.CONTEXT_COMPACTED)
    ) {
      this.compactionActive = false;
      this.emitCompactionBoundary();
    }

    if (method === APP_SERVER_NOTIFICATIONS.ITEM_COMPLETED) {
      this.captureAgentMessage(params);
      this.capturePlanProposal(params);
    }
    if (method === APP_SERVER_NOTIFICATIONS.PLAN_DELTA) {
      this.captureStreamedPlanProposal(params);
    }

    if (method === APP_SERVER_NOTIFICATIONS.TOKEN_USAGE_UPDATED) {
      this.emitUsageExtNotification(params);
    }

    if (method === APP_SERVER_NOTIFICATIONS.TURN_COMPLETED) {
      this.commandOutputs.clear();
      const turn = (params as { turn?: { id?: string; status?: string } })
        ?.turn;
      // Drop the late completion of an already-interrupted turn (else it cancels the follow-up).
      if (this.turns.shouldDropCompletion(turn?.id)) return;
      void this.finalizeTurn(mapTurnStopReason(turn?.status));
    }

    if (method === APP_SERVER_NOTIFICATIONS.ERROR) {
      // A non-retried fatal error: resolve the turn so prompt() returns rather than hangs.
      const willRetry = (params as { willRetry?: boolean })?.willRetry;
      if (willRetry === false) {
        this.logger.warn("codex app-server fatal error notification", {
          params,
        });
        void this.finalizeTurn("refusal");
      }
    }
  }

  private withBufferedCommandOutput(method: string, params: unknown): unknown {
    if (!params || typeof params !== "object") {
      return params;
    }
    const value = params as {
      itemId?: unknown;
      delta?: unknown;
      item?: Record<string, unknown>;
    };

    if (method === APP_SERVER_NOTIFICATIONS.COMMAND_OUTPUT_DELTA) {
      if (typeof value.itemId === "string" && typeof value.delta === "string") {
        this.commandOutputs.set(
          value.itemId,
          `${this.commandOutputs.get(value.itemId) ?? ""}${value.delta}`,
        );
      }
      return params;
    }

    if (method !== APP_SERVER_NOTIFICATIONS.ITEM_COMPLETED) {
      return params;
    }

    const itemId = value.item?.id;
    if (typeof itemId !== "string") {
      return params;
    }

    const output = this.commandOutputs.get(itemId);
    this.commandOutputs.delete(itemId);
    if (
      value.item?.type !== "commandExecution" ||
      value.item.aggregatedOutput != null ||
      !output
    ) {
      return params;
    }

    return {
      ...value,
      item: { ...value.item, aggregatedOutput: output },
    };
  }

  /** Track the latest assistant message so the final one feeds structured output. */
  private captureAgentMessage(params: unknown): void {
    const item = (params as { item?: { type?: string; text?: string } })?.item;
    if (item?.type === "agentMessage" && typeof item.text === "string") {
      this.lastAgentMessage = item.text;
    }
  }

  /** Remember the turn's completed plan item (codex plan mode's authoritative <proposed_plan>). */
  private capturePlanProposal(params: unknown): void {
    const item = (
      params as { item?: { type?: string; id?: string; text?: string } }
    )?.item;
    if (item?.type === "plan" && typeof item.text === "string" && item.text) {
      this.planProposal = { itemId: item.id ?? "codex-plan", text: item.text };
    }
  }

  /** Accumulate the proposal stream used by codex builds that emit no completed plan item. */
  private captureStreamedPlanProposal(params: unknown): void {
    const { itemId, delta } = params as {
      itemId?: unknown;
      delta?: unknown;
    };
    if (typeof delta !== "string" || !delta) return;
    const proposalId =
      typeof itemId === "string" && itemId
        ? itemId
        : (this.planProposal?.itemId ?? "codex-plan");
    const previousText =
      this.planProposal?.itemId === proposalId ? this.planProposal.text : "";
    this.planProposal = { itemId: proposalId, text: previousText + delta };
  }

  /** Compaction started: emit `_posthog/status` so the host sets `isCompacting` (gates steer/queue). */
  private emitCompactionStarted(): void {
    if (!this.sessionId) return;
    void this.client
      .extNotification(POSTHOG_NOTIFICATIONS.STATUS, {
        sessionId: this.sessionId,
        status: "compacting",
      })
      .catch(() => undefined);
  }

  /** Compaction finished: emit `_posthog/compact_boundary` (host clears isCompacting) + a transcript marker. */
  private emitCompactionBoundary(): void {
    if (!this.sessionId) return;
    void this.client
      .extNotification(POSTHOG_NOTIFICATIONS.COMPACT_BOUNDARY, {
        sessionId: this.sessionId,
      })
      .catch(() => undefined);
    void this.client
      .sessionUpdate({
        sessionId: this.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "\n\nContext compacted." },
        },
      })
      .catch(() => undefined);
  }

  /** Emit `_posthog/usage_update` so the host's token/cost UI fills. */
  private emitUsageExtNotification(params: unknown): void {
    if (!this.sessionId) return;
    const update = this.usage.ingest(params);
    if (!update) return;
    void this.client
      .extNotification(POSTHOG_NOTIFICATIONS.USAGE_UPDATE, {
        sessionId: this.sessionId,
        ...update,
      })
      .catch((err) => this.logger.warn("usage extNotification failed", err));
  }

  /** Deliver structured output (parsed from the final message) before resolving the turn. */
  private async finalizeTurn(reason: StopReason): Promise<void> {
    // Idempotent: claim synchronously (before any await) so a second finalize (e.g. an
    // error racing turn/completed) is a no-op and callbacks don't double-fire.
    const pending = this.turns.claim();
    if (!pending) return;
    // If the turn dies mid-compaction the boundary never fires, leaving isCompacting stuck
    // true (silently queuing later messages). Recover here.
    if (this.compactionActive) {
      this.compactionActive = false;
      this.emitCompactionBoundary();
    }
    const message = this.lastAgentMessage;
    // Per-turn usage is codex's own `tokenUsage.last` (not a reconstructed delta).
    const usage = this.usage.perTurnUsage();
    const contextUsed = this.usage.contextTokens();

    // Deliver structured output only on a clean end_turn — a cancelled/refused turn records nothing.
    if (
      reason === "end_turn" &&
      this.jsonSchema &&
      this.onStructuredOutput &&
      message
    ) {
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
    if (this.willOfferPlanHandoff(reason)) {
      // Defer the canonical idle signal: the handoff (and a possible implementation
      // turn) keeps this prompt busy, and the cloud host treats turn_complete as
      // idle — emitting it now would flush queued prompts into the handoff.
      this.deferredTurnComplete = { usage };
      await this.emitUsageBreakdown(contextUsed);
    } else {
      await this.emitTurnCompleteSignal(reason, usage);
      await this.emitUsageBreakdown(contextUsed);
    }
    pending.resolve(reason);
  }

  /** Whether maybeOfferPlanImplementation will run for a turn that ended this way. */
  private willOfferPlanHandoff(reason: StopReason): boolean {
    return (
      reason === "end_turn" &&
      this.config.mode === "plan" &&
      !!this.planProposal &&
      !this.session.cancelled
    );
  }

  /** Emit the cloud idle signal `_posthog/turn_complete` (only with a taskRunId). */
  private async emitTurnCompleteSignal(
    reason: StopReason,
    usage: AccumulatedUsage,
  ): Promise<void> {
    if (!this.sessionId || !this.taskRunId) return;
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

  /** Emit the `_posthog/usage_update` context breakdown for the host's token UI. */
  private async emitUsageBreakdown(
    contextUsed: number | undefined,
  ): Promise<void> {
    if (!this.sessionId || contextUsed === undefined) return;
    await this.client
      .extNotification(
        POSTHOG_NOTIFICATIONS.USAGE_UPDATE,
        buildUsageBreakdownParams(
          this.sessionId,
          this.usage.baselineBreakdown,
          contextUsed,
        ) as unknown as Record<string, unknown>,
      )
      .catch((err) =>
        this.logger.warn("usage breakdown extNotification failed", err),
      );
  }

  private handleServerClosed(): void {
    this.turns.fail(
      new Error("codex app-server exited before the turn completed"),
    );
  }

  /**
   * Server-initiated requests. Simple approvals resolve to a `{ decision }` envelope (a bare
   * string is rejected); richer ones (AskUserQuestion / permission profile / elicitation) go
   * to `handleServerRequest`. Whatever we return is sent back as the JSON-RPC result.
   */
  private async handleApproval(
    method: string,
    params: unknown,
  ): Promise<unknown> {
    const richer = await handleServerRequest(method, params, this.client, {
      sessionId: this.sessionId,
      logger: this.logger,
      resolveMcpToolCall: (serverName) => this.mcp.byServer(serverName),
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
      availableDecisions?: unknown[];
    };
    // codex lists the decisions valid for this prompt. An "approve and remember"
    // decision is echoed back verbatim: either the string "acceptForSession" or the
    // acceptWithExecpolicyAmendment object carrying the proposed allowlist amendment.
    const availableDecisions = Array.isArray(detail.availableDecisions)
      ? detail.availableDecisions
      : [];
    const offeredRememberDecision =
      availableDecisions.find(
        (d) =>
          !!d && typeof d === "object" && "acceptWithExecpolicyAmendment" in d,
      ) ?? availableDecisions.find((d) => d === "acceptForSession");
    // File-change approvals normally omit availableDecisions, but codex accepts the
    // session-scoped decision for them. If codex sends an explicit list, honor it.
    const rememberDecision: unknown =
      isFileChange && detail.availableDecisions === undefined
        ? "acceptForSession"
        : offeredRememberDecision;
    // Label the actual scope: an execpolicy amendment persists in the command
    // allowlist; acceptForSession (commands and file changes) lasts one session.
    const rememberLabel =
      typeof rememberDecision === "object"
        ? "Allow similar commands and don't ask again"
        : "Allow for the rest of this session";
    const title =
      detail.command ?? (isFileChange ? "Apply file changes" : "Run command");
    const toolCallId = detail.itemId ?? "codex-approval";
    // Codex has no MCP-specific approval; a known MCP call surfaces the real server/tool/args
    // so the host renders the proper MCP permission (incl. PostHog `exec` unwrapping).
    const mcp = this.mcp.byItemId(detail.itemId);
    // kind + content route plain command/file approvals to Execute/EditPermission (not the fallback).
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
                  name: rememberLabel,
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
          // Echo codex's "approve and remember" decision so it applies the proposed amendment.
          return { decision: rememberDecision };
        }
        if (response.outcome.optionId === "allow") {
          return { decision: "accept" };
        }
        if (response.outcome.optionId === "reject_with_feedback") {
          // codex's response has no feedback field, so decline and inject the guidance
          // into the running turn (as its TUI does: Denied + a follow-up message).
          const feedback = (response as { _meta?: { customInput?: unknown } })
            ._meta?.customInput;
          const activeTurnId = this.turns.activeTurnId;
          if (typeof feedback === "string" && feedback.trim() && activeTurnId) {
            void this.rpc
              .request<{ turnId?: string }>(APP_SERVER_METHODS.TURN_STEER, {
                threadId: this.threadId,
                input: toCodexInput([{ type: "text", text: feedback.trim() }]),
                expectedTurnId: activeTurnId,
              })
              // codex rotates the turn id on steer; adopt it or later
              // interrupts/steers target a dead turn.
              .then((res) => this.turns.onSteered(res?.turnId))
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

// BASELINE_TOKENS from codex-rs protocol.rs — the resident floor we can't attribute per-source.
const CODEX_BASELINE_TOKENS = 12000;

// The implementation kickoff message, matching codex's own TUI plan handoff.
const IMPLEMENT_PLAN_MESSAGE = "Implement the plan.";

/** codex `TurnStatus` → ACP `StopReason`: interrupted → cancel, failed → refusal, else end. */
function mapTurnStopReason(status: string | undefined): StopReason {
  if (status === "interrupted") return "cancelled";
  if (status === "failed") return "refusal";
  return "end_turn";
}

/** The codex thread config override map: folds in MCP servers + makes extra workspace roots writable. Undefined when empty. */
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

/** Seed the context-breakdown baseline with the resident floor + the host's system prompt. */
function buildBaseline(
  meta: AppServerSessionMeta | undefined,
): ContextBreakdownBaseline {
  const baseline = emptyBaseline();
  baseline.systemPrompt =
    CODEX_BASELINE_TOKENS +
    estimateTokens(flattenSystemPrompt(meta?.systemPrompt));
  return baseline;
}

/** Flatten the host's systemPrompt (`string | { append }`) to a string (else "[object Object]"). */
function flattenSystemPrompt(
  systemPrompt: string | { append?: string } | undefined,
): string | undefined {
  if (typeof systemPrompt === "string") return systemPrompt || undefined;
  if (systemPrompt && typeof systemPrompt.append === "string") {
    return systemPrompt.append || undefined;
  }
  return undefined;
}
