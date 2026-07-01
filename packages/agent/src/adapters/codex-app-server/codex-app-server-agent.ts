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
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  StopReason,
} from "@agentclientprotocol/sdk";
import { mcpToolKey, posthogToolMeta } from "@posthog/shared";
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
import { McpManager } from "./mcp-manager";
import {
  APP_SERVER_METHODS,
  APP_SERVER_NOTIFICATIONS,
  APP_SERVER_REQUESTS,
} from "./protocol";
import { SessionConfigState } from "./session-config";
import {
  type CodexAppServerProcess,
  type CodexAppServerProcessOptions,
  spawnCodexAppServerProcess,
} from "./spawn";
import { TurnController } from "./turn-controller";
import { UsageTracker } from "./usage-tracker";

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
  /** Model / reasoning-effort / mode selectors + the derived configOptions. */
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
  /**
   * Deployment environment from the host `_meta`. Gates the per-turn
   * `sandboxPolicy` mode override: on "cloud" a non-danger sandbox would
   * re-engage the unavailable linux-sandbox and panic, so we leave the spawned
   * danger-full-access in place there.
   */
  private environment?: "local" | "cloud";
  /** Session MCP tool-call state; correlates approval prompts to the real tool. */
  private readonly mcp = new McpManager();
  /** The turn state machine: turnId, pending completion, steer/interrupt races. */
  private readonly turns = new TurnController();
  /** Token usage + context-breakdown state, driven by codex's tokenUsage.last. */
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
    return { sessionId: threadId, configOptions: this.config.options };
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
    return { configOptions: this.config.options };
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
    return { configOptions: this.config.options };
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
    return { sessionId: threadId, configOptions: this.config.options };
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
    this.taskRunId = params.meta?.taskRunId;
    this.environment = params.meta?.environment;
    // Honor the host's initial approval mode (mirrors codex-acp). A non-codex
    // value falls back to the default; setSessionConfigOption can change it later.
    this.config.setInitialMode(params.meta?.permissionMode);
    // Codex doesn't attribute input tokens by source, so seed the breakdown with
    // the always-resident floor + the host's system prompt (mirrors codex-acp's
    // buildCodexBaseline) and let the live contextUsed count fill conversation.
    this.usage.setBaseline(buildBaseline(params.meta));
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
    // Degrade gracefully: if the bundled server script can't be resolved (a
    // packaging gap, or running from source), skip local-tools with a loud
    // warning rather than throwing — a missing optional tool must not kill the
    // whole session's thread setup.
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
    const { modeChanged } = this.config.setOption(configId, value);
    // collaborationMode rides the next turn/start (see prompt()), so a mode
    // switch only needs current_mode_update here — it takes effect next turn.
    if (modeChanged) this.emitCurrentMode(this.config.mode);
    this.emitConfigOptions();
    return { configOptions: this.config.options };
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

    if (this.turns.isRunning) {
      // A turn is already running: rather than fail (the codex-acp/Claude
      // behavior is to fold the message in), steer it via turn/steer with the
      // active turnId as the precondition. The existing turn keeps resolving on
      // its original turn/completed.
      // turn/steer returns the (possibly rotated) active turnId; refresh it so a
      // later turn/steer's expectedTurnId precondition and a turn/interrupt still
      // target the live turn (turn/started is not re-emitted for a steer).
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
      // A turn is pending but we never saw turn/started (no turnId yet), so we
      // can't steer. Fail fast rather than clobber the single pending slot.
      throw new Error("prompt() called while a turn is already in progress");
    }

    this.lastAgentMessage = "";
    this.resetUsage();
    const completion = this.turns.begin();
    try {
      const approvalPolicy = this.config.approvalPolicy();
      const sandboxPolicy = this.config.sandboxPolicy();
      const activePermissionProfile = this.config.permissionProfile();
      await this.rpc.request(APP_SERVER_METHODS.TURN_START, {
        threadId: this.threadId,
        input,
        model: this.config.model,
        ...(this.config.effort ? { effort: this.config.effort } : {}),
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
        collaborationMode: this.config.collaborationModeForTurn(),
        ...(this.environment !== "cloud" && sandboxPolicy
          ? { sandboxPolicy }
          : {}),
        // codex 0.140.0 enforces the sandbox through named permission profiles;
        // the raw sandboxPolicy above is no longer honored on its own, so
        // plan/read-only also send `activePermissionProfile: {extends:":read-only"}`.
        // Same cloud gating — a restrictive profile would re-engage the absent
        // linux-sandbox there.
        ...(this.environment !== "cloud" && activePermissionProfile
          ? { activePermissionProfile }
          : {}),
        // Constrain the final assistant message to the task's schema so it is
        // valid JSON we can parse for structured output (replaces the codex-acp
        // `create_output` MCP, which the native app-server has no need for).
        ...(this.jsonSchema ? { outputSchema: this.jsonSchema } : {}),
      });
      return { stopReason: await completion };
    } finally {
      this.turns.finishPrompt();
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

  private resetUsage(): void {
    this.usage.resetForTurn();
  }

  protected async interrupt(): Promise<void> {
    // Tell the server to stop first, then finalize through the shared path so a
    // cancelled turn still emits the cloud notifications (_posthog/turn_complete)
    // the host treats as the idle/queue-dispatch signal — matching codex-acp.
    // finalizeTurn claims the turn idempotently, so the server's later
    // turn/completed(interrupted) is a no-op.
    // TurnInterruptParams requires BOTH threadId and turnId (the native binary
    // rejects a turnId-less request with -32600, leaving the turn running).
    // markInterrupted returns the live turnId (and remembers it so its late
    // turn/completed(interrupted) is dropped rather than finalizing a follow-up
    // turn). When no turn/started was seen yet there is no server-side turn to
    // abort, so skip the RPC and just finalize.
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
    this.session.abortController.abort();
    // Resolve any in-flight turn and drain interrupted-turn ids so the set can't
    // accumulate across a long-lived process (each is normally removed when its
    // late completion arrives, but a dropped one would linger).
    this.turns.close("cancelled");
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

    if (method === APP_SERVER_NOTIFICATIONS.TURN_STARTED) {
      // Capture the active turn id; it's the precondition turn/steer requires
      // and the target turn/interrupt aborts. onStarted ignores it unless a turn
      // is pending, so a stale/duplicate turn/started can't install a stray id.
      this.turns.onStarted((params as { turn?: { id?: string } })?.turn?.id);
    }

    if (
      method === APP_SERVER_NOTIFICATIONS.ITEM_STARTED ||
      method === APP_SERVER_NOTIFICATIONS.ITEM_COMPLETED
    ) {
      this.mcp.capture(params);
    }

    // codex auto-compaction surfaces as a contextCompaction item bracketing the
    // work: item/started marks it in progress (gates steering/queue host-side),
    // and item/completed is the boundary (empirically codex does NOT emit a
    // separate thread/compacted — the item lifecycle is the signal). A
    // thread/compacted, if one ever arrives, is a guarded fallback. The
    // `compactionActive` flag dedupes so only one boundary fires per compaction.
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
    }

    if (method === APP_SERVER_NOTIFICATIONS.TOKEN_USAGE_UPDATED) {
      this.emitUsageExtNotification(params);
    }

    if (method === APP_SERVER_NOTIFICATIONS.TURN_COMPLETED) {
      const turn = (params as { turn?: { id?: string; status?: string } })
        ?.turn;
      // Drop the late completion of a turn we already interrupted so it can't
      // finalize the current (follow-up) turn as cancelled.
      if (this.turns.shouldDropCompletion(turn?.id)) return;
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

  /** Track the latest assistant message so the final one feeds structured output. */
  private captureAgentMessage(params: unknown): void {
    const item = (params as { item?: { type?: string; text?: string } })?.item;
    if (item?.type === "agentMessage" && typeof item.text === "string") {
      this.lastAgentMessage = item.text;
    }
  }

  /**
   * Compaction started: mirror the Claude adapter's `_posthog/status` so the
   * host sets `isCompacting` (which gates steering + queue dispatch). The host
   * reads `isCompacting = !isComplete`, so omitting it means "in progress".
   */
  private emitCompactionStarted(): void {
    if (!this.sessionId) return;
    void this.client
      .extNotification(POSTHOG_NOTIFICATIONS.STATUS, {
        sessionId: this.sessionId,
        status: "compacting",
      })
      .catch(() => undefined);
  }

  /**
   * Compaction finished: mirror the Claude adapter's `_posthog/compact_boundary`
   * (the host clears `isCompacting` + drains the queued messages) plus a
   * user-visible transcript marker. The context indicator updates on its own —
   * the next `thread/tokenUsage/updated` carries the reduced `tokenUsage.last`.
   */
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

  /** Mirror codex-acp's `_posthog/usage_update` so the host's token/cost UI fills. */
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

  /**
   * Parses the schema-constrained final message into structured output and
   * delivers it before resolving the turn, so the host's `setTaskRunOutput`
   * has completed by the time `prompt()` returns.
   */
  private async finalizeTurn(reason: StopReason): Promise<void> {
    // Idempotent: claim the pending turn synchronously (before any await) so a
    // second finalize for the same turn — e.g. an `error` notification racing
    // turn/completed — is a no-op and the structured-output callback + cloud
    // notifications don't double-fire. claim() clears both the pending slot and
    // the turnId in one step, so a steer/fresh prompt racing into the await
    // window below sees no live turn.
    const pending = this.turns.claim();
    if (!pending) return;
    // If the turn ends while a compaction is still in progress (interrupt or a
    // fatal error before item/completed(contextCompaction)), the boundary would
    // never fire — leaving the host's `isCompacting` stuck true, which silently
    // queues every later user message. Clear the flag and emit the boundary here
    // (idempotent: only the first finalize for a turn gets past claim()) so the
    // host recovers instead of wedging.
    if (this.compactionActive) {
      this.compactionActive = false;
      this.emitCompactionBoundary();
    }
    const message = this.lastAgentMessage;
    // Per-turn usage is codex's own `tokenUsage.last` (not a reconstructed delta).
    const usage = this.usage.perTurnUsage();
    const contextUsed = this.usage.contextTokens();

    // Deliver structured output only on a clean completion — a cancelled
    // (user-interrupted) or refused turn must not record task output the host
    // considers failed (mirrors the Claude adapter's success-only delivery).
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
            this.usage.baselineBreakdown,
            contextUsed,
          ) as unknown as Record<string, unknown>,
        )
        .catch((err) =>
          this.logger.warn("usage breakdown extNotification failed", err),
        );
    }
  }

  private handleServerClosed(): void {
    this.turns.fail(
      new Error("codex app-server exited before the turn completed"),
    );
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
    const mcp = this.mcp.byItemId(detail.itemId);
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
          const feedback = (response as { _meta?: { customInput?: unknown } })
            ._meta?.customInput;
          const activeTurnId = this.turns.activeTurnId;
          if (typeof feedback === "string" && feedback.trim() && activeTurnId) {
            void this.rpc
              .request(APP_SERVER_METHODS.TURN_STEER, {
                threadId: this.threadId,
                input: toCodexInput([{ type: "text", text: feedback.trim() }]),
                expectedTurnId: activeTurnId,
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
