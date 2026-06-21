// biome-ignore-all lint/suspicious/noExplicitAny: SessionServiceDeps is the
// host seam for the ported renderer SessionService; the trpc/store/helper ports
// are satisfied by the desktop adapter and typed loosely at this boundary.
import type {
  ContentBlock,
  RequestPermissionRequest,
  SessionConfigOption,
  SessionUpdate,
} from "@agentclientprotocol/sdk";
import {
  type AcpMessage,
  type Adapter,
  type AgentSession,
  type CloudRegion,
  type ExecutionMode,
  flattenSelectOptions,
  getBackoffDelay,
  getCloudUrlFromRegion,
  getConfigOptionByCategory,
  isFatalSessionError,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
  isRateLimitError,
  mergeConfigOptions,
  type OptimisticItem,
  type PermissionRequest,
  type QueuedMessage,
  type StoredLogEntry,
  type TaskRunStatus,
} from "@posthog/shared";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import {
  type CloudTaskPermissionRequestUpdate,
  type CloudTaskUpdatePayload,
  type EffortLevel,
  effortLevelSchema,
  isTerminalStatus,
  type Task,
} from "@posthog/shared/domain-types";
import { isNotification, POSTHOG_NOTIFICATIONS } from "./acpNotifications";
import { createAppendOnlyTracker } from "./appendOnlyTracker";
import type { CloudArtifactClient } from "./cloudArtifactIdentifiers";
import { classifyCloudLogAppend } from "./cloudLogGap";
import { CloudLogGapReconciler } from "./cloudLogGapReconciler";
import { CloudRunIdleTracker } from "./cloudRunIdleTracker";
import {
  getCloudPrAuthorshipMode,
  getCloudRunSource,
  getCloudRuntimeOptions,
} from "./cloudRunOptions";
import {
  buildCloudDefaultConfigOptions,
  extractLatestConfigOptionsFromEntries,
} from "./cloudSessionConfig";
import {
  computeAutoRetryFinalState,
  OFFLINE_SESSION_MESSAGE,
  routeLocalConnect,
} from "./connectRouting";
import {
  type PermissionSelectionPlan,
  planPermissionResponse,
} from "./permissionResponse";
import {
  convertStoredEntriesToEvents,
  createUserPromptEvent,
  createUserShellExecuteEvent,
  extractPromptText,
  getUserShellExecutesSinceLastPrompt,
  hasSessionPromptEvent,
  isTurnCompleteEvent,
  normalizePromptToBlocks,
  promptReferencesAbsoluteFolder,
  shellExecutesToContextBlocks,
} from "./sessionEvents";
import { createBaseSession } from "./sessionFactory";
import {
  type ParsedSessionLogs,
  parseSessionLogContent,
  planSkippedPromptFilter,
} from "./sessionLogs";

const LOCAL_SESSION_RECONNECT_ATTEMPTS = 3;
const LOCAL_SESSION_RECONNECT_BACKOFF = {
  initialDelayMs: 1_000,
  maxDelayMs: 5_000,
};
const LOCAL_SESSION_RECOVERY_MESSAGE =
  "Lost connection to the agent. Reconnecting…";
const LOCAL_SESSION_RECOVERY_FAILED_MESSAGE =
  "Connecting to to the agent has been lost. Retry, or start a new session.";
const GITHUB_AUTHORIZATION_REQUIRED_CODE = "github_authorization_required";
const AUTO_RETRY_MAX_ATTEMPTS = 2;
const AUTO_RETRY_DELAY_MS = 10_000;
const AUTH_RESTORE_MAX_RETRY_WAITS = 6;

class GitHubAuthorizationRequiredForCloudHandoffError extends Error {
  constructor(
    message = "Connect GitHub before continuing this task in cloud.",
  ) {
    super(message);
    this.name = "GitHubAuthorizationRequiredForCloudHandoffError";
  }
}

type TrpcMutation = { mutate: (input?: any) => Promise<any> };
type TrpcQuery = { query: (input?: any) => Promise<any> };
type TrpcSubscription = {
  subscribe: (
    input: any,
    handlers: { onData: (data: any) => void; onError?: (err: unknown) => void },
  ) => { unsubscribe: () => void };
};

export interface SessionTrpc {
  agent: {
    start: TrpcMutation;
    reconnect: TrpcMutation;
    cancel: TrpcMutation;
    prompt: TrpcMutation;
    cancelPrompt: TrpcMutation;
    cancelPermission: TrpcMutation;
    respondToPermission: TrpcMutation;
    setConfigOption: TrpcMutation;
    resetAll: TrpcMutation;
    recordActivity: TrpcMutation;
    getPreviewConfigOptions: TrpcQuery;
    onSessionEvent: TrpcSubscription;
    onPermissionRequest: TrpcSubscription;
    onSessionIdleKilled: TrpcSubscription;
  };
  workspace: { verify: TrpcQuery };
  cloudTask: {
    watch: TrpcMutation;
    unwatch: TrpcMutation;
    retry: TrpcMutation;
    sendCommand: TrpcMutation;
    onUpdate: TrpcSubscription;
  };
  handoff: {
    execute: TrpcMutation;
    executeToCloud: TrpcMutation;
    preflight: TrpcQuery;
    preflightToCloud: TrpcQuery;
  };
  logs: {
    readLocalLogs: TrpcQuery;
    fetchS3Logs: TrpcQuery;
    writeLocalLogs: TrpcMutation;
  };
  os: { openExternal: TrpcMutation };
}

export interface ISessionStore {
  setSession(session: AgentSession): void;
  removeSession(taskRunId: string): void;
  updateSession(taskRunId: string, updates: Partial<AgentSession>): void;
  appendEvents(
    taskRunId: string,
    events: AcpMessage[],
    newLineCount?: number,
  ): void;
  updateCloudStatus(
    taskRunId: string,
    fields: {
      status?: TaskRunStatus;
      stage?: string | null;
      output?: Record<string, unknown> | null;
      errorMessage?: string | null;
      branch?: string | null;
    },
  ): void;
  setPendingPermissions(
    taskRunId: string,
    permissions: Map<string, PermissionRequest>,
  ): void;
  enqueueMessage(
    taskId: string,
    content: string,
    rawPrompt?: string | ContentBlock[],
  ): void;
  removeQueuedMessage(taskId: string, messageId: string): void;
  clearMessageQueue(taskId: string): void;
  dequeueMessagesAsText(taskId: string): string | null;
  dequeueMessages(taskId: string): QueuedMessage[];
  prependQueuedMessages(taskId: string, messages: QueuedMessage[]): void;
  appendOptimisticItem(
    taskRunId: string,
    item: OptimisticItem extends infer T
      ? T extends { id: string }
        ? Omit<T, "id">
        : never
      : never,
  ): void;
  clearOptimisticItems(taskRunId: string): void;
  clearTailOptimisticItems(taskRunId: string): void;
  replaceOptimisticWithEvent(taskRunId: string, event: AcpMessage): void;
  getSessionByTaskId(taskId: string): AgentSession | undefined;
  getSessions(): Record<string, AgentSession>;
}

export interface SessionServiceHelpers {
  extractSkillButtonId: (...args: any[]) => any;
  cloudPromptToBlocks: (...args: any[]) => any;
  combineQueuedCloudPrompts: (...args: any[]) => any;
  getCloudPromptTransport: (...args: any[]) => any;
  uploadRunAttachments: (
    client: CloudArtifactClient,
    taskId: string,
    runId: string,
    filePaths: string[],
  ) => Promise<string[]>;
  uploadTaskStagedAttachments: (
    client: CloudArtifactClient,
    taskId: string,
    filePaths: string[],
  ) => Promise<string[]>;
}

export interface SessionServiceDeps {
  trpc: SessionTrpc;
  store: ISessionStore;
  h: SessionServiceHelpers;
  log: {
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
    debug(message: string, data?: unknown): void;
  };
  toast: {
    error: (msg: any, opts?: any) => unknown;
    info: (msg: any, opts?: any) => unknown;
  };
  track: (event: string, props?: Record<string, unknown>) => void;
  buildPermissionToolMetadata: (...args: any[]) => any;
  notifyPermissionRequest: (...args: any[]) => any;
  notifyPromptComplete: (...args: any[]) => any;
  getIsOnline: () => boolean;
  fetchAuthState: () => Promise<any>;
  getAuthenticatedClient: () => Promise<any>;
  createAuthenticatedClient: (authState: any) => any;
  getPersistedConfigOptions: (
    taskRunId: string,
  ) => SessionConfigOption[] | undefined;
  setPersistedConfigOptions: (
    taskRunId: string,
    options: SessionConfigOption[],
  ) => void;
  removePersistedConfigOptions: (taskRunId: string) => void;
  updatePersistedConfigOptionValue: (...args: any[]) => any;
  adapterStore: {
    getAdapter(taskRunId: string): Adapter | undefined;
    setAdapter(taskRunId: string, adapter: Adapter): void;
    removeAdapter(taskRunId: string): void;
  };
  readonly settings: { customInstructions?: string | null };
  usageLimit: { show: (...args: any[]) => any };
  readonly addDirectoryDialog: { open: boolean };
  taskViewedApi: { markActivity(taskId: string): void };
  queryClient: {
    invalidateQueries: (filters?: any) => any;
    refetchQueries: (filters?: any) => any;
  };
  DEFAULT_GATEWAY_MODEL: string;
  WORKSPACE_QUERY_KEY: any;
}

type AuthClient = NonNullable<
  Awaited<ReturnType<SessionServiceDeps["getAuthenticatedClient"]>>
>;

interface AuthCredentials {
  apiHost: string;
  projectId: number;
  client: AuthClient;
}

type AuthCredentialsStatus =
  | { kind: "ready"; auth: AuthCredentials }
  | { kind: "restoring" }
  | { kind: "missing" };

export interface ConnectParams {
  task: Task;
  repoPath: string;
  initialPrompt?: ContentBlock[];
  executionMode?: ExecutionMode;
  adapter?: "claude" | "codex";
  model?: string;
  reasoningLevel?: string;
}

export interface CloudConnectionAuth {
  status: string;
  bootstrapComplete?: boolean;
  projectId?: number | null;
  cloudRegion?: CloudRegion | null;
}

export interface ReconcileSessionState {
  taskRunId: string;
  taskId: string;
  taskTitle: string;
  status: AgentSession["status"];
  isCloud?: boolean;
  idleKilled?: boolean;
  eventCount: number;
}

export interface ReconcileTaskConnectionParams {
  task: Task;
  session: ReconcileSessionState | undefined;
  repoPath: string | null;
  isCloud: boolean;
  isSuspended?: boolean;
  isOnline: boolean;
  cloudAuth: CloudConnectionAuth;
  onCloudStatusChange?: () => void;
}

const ACTIVITY_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

export type SessionPlan = Extract<SessionUpdate, { sessionUpdate: "plan" }>;

export function selectLatestPlan(events: AcpMessage[]): SessionPlan | null {
  let planIndex = -1;
  let plan: SessionPlan | null = null;
  let turnEndResponseIndex = -1;

  for (let i = events.length - 1; i >= 0; i--) {
    const msg = events[i].message;

    if (
      turnEndResponseIndex === -1 &&
      isJsonRpcResponse(msg) &&
      (msg.result as { stopReason?: string })?.stopReason !== undefined
    ) {
      turnEndResponseIndex = i;
    }

    if (
      planIndex === -1 &&
      isJsonRpcNotification(msg) &&
      msg.method === "session/update"
    ) {
      const update = (msg.params as { update?: { sessionUpdate?: string } })
        ?.update;
      if (update?.sessionUpdate === "plan") {
        planIndex = i;
        plan = update as SessionPlan;
      }
    }

    if (planIndex !== -1 && turnEndResponseIndex !== -1) break;
  }

  if (turnEndResponseIndex > planIndex) return null;

  return plan;
}

export function createLatestPlanTracker() {
  return createAppendOnlyTracker<
    { plan: SessionPlan | null },
    SessionPlan | null
  >({
    init: () => ({ plan: null }),
    processEvent: (state, event) => {
      const msg = event.message;

      if (
        isJsonRpcResponse(msg) &&
        (msg.result as { stopReason?: string })?.stopReason !== undefined
      ) {
        state.plan = null;
        return;
      }

      if (isJsonRpcNotification(msg) && msg.method === "session/update") {
        const update = (msg.params as { update?: { sessionUpdate?: string } })
          ?.update;
        if (update?.sessionUpdate === "plan") {
          state.plan = update as SessionPlan;
        }
      }
    },
    getResult: (state) => state.plan,
  });
}

export const SESSION_SERVICE = Symbol.for("posthog.core.sessions.service");

type DerivedPermissionRequest = Pick<
  CloudTaskPermissionRequestUpdate,
  "requestId" | "toolCall" | "options"
>;

export function derivePendingPermissionRequests(
  entries: StoredLogEntry[],
): DerivedPermissionRequest[] {
  const requests = new Map<string, DerivedPermissionRequest>();
  const resolved = new Set<string>();
  for (const entry of entries) {
    const method = entry.notification?.method;
    if (!method) continue;
    const params = (entry.notification?.params ?? {}) as {
      requestId?: string;
      toolCall?: CloudTaskPermissionRequestUpdate["toolCall"];
      options?: CloudTaskPermissionRequestUpdate["options"];
    };
    if (typeof params.requestId !== "string") continue;
    if (isNotification(method, POSTHOG_NOTIFICATIONS.PERMISSION_RESOLVED)) {
      resolved.add(params.requestId);
    } else if (
      isNotification(method, POSTHOG_NOTIFICATIONS.PERMISSION_REQUEST) &&
      typeof params.toolCall?.toolCallId === "string" &&
      Array.isArray(params.options)
    ) {
      requests.set(params.requestId, {
        requestId: params.requestId,
        toolCall: params.toolCall,
        options: params.options,
      });
    }
  }
  return [...requests.values()].filter((r) => !resolved.has(r.requestId));
}

/**
 * Whether a derived permission request has already been surfaced for this
 * session. Snapshot replays re-deliver still-pending requests on every
 * bootstrap and re-subscribe; only the first delivery should notify. A
 * different requestId for the same tool call is a new ask and must notify.
 */
export function isPermissionRequestAlreadySurfaced(
  pendingPermissions: ReadonlyMap<string, unknown>,
  trackedRequestId: string | undefined,
  update: DerivedPermissionRequest,
): boolean {
  return (
    trackedRequestId === update.requestId &&
    pendingPermissions.has(update.toolCall.toolCallId)
  );
}

function classifyTurnEventKind(
  msg: AcpMessage["message"],
): "text" | "output" | "other" {
  if (!("method" in msg) || msg.method !== "session/update") return "other";
  const update = (msg as { params?: { update?: Record<string, unknown> } })
    .params?.update;
  if (!update) return "other";
  const sessionUpdate = update.sessionUpdate;
  if (sessionUpdate === "agent_message_chunk") {
    const content = update.content as { type?: string } | undefined;
    return content?.type === "text" ? "text" : "output";
  }
  if (
    sessionUpdate === "agent_thought_chunk" ||
    sessionUpdate === "tool_call" ||
    sessionUpdate === "tool_call_update"
  ) {
    return "output";
  }
  return "other";
}

export class SessionService {
  private connectingTasks = new Map<string, Promise<void>>();
  private reconcilingTasks = new Set<string>();
  private activityHeartbeats = new Map<
    string,
    ReturnType<typeof setInterval>
  >();
  private localRepoPaths = new Map<string, string>();
  private localRecoveryAttempts = new Map<string, Promise<boolean>>();
  /** Re-entrance guard for cloud queue dispatch (per taskId). */
  private dispatchingCloudQueues = new Set<string>();
  /** Coalesces deferred cloud queue flush timers (per taskId). */
  private scheduledCloudQueueFlushes = new Set<string>();
  private cloudRunIdleTracker: CloudRunIdleTracker;
  private nextCloudTaskWatchToken = 0;
  private subscriptions = new Map<
    string,
    {
      event: { unsubscribe: () => void };
      permission?: { unsubscribe: () => void };
    }
  >();
  /** Active cloud task watchers, keyed by taskId */
  private cloudTaskWatchers = new Map<
    string,
    {
      runId: string;
      apiHost: string;
      teamId: number;
      startToken: number;
      subscription: { unsubscribe: () => void };
      onStatusChange?: () => void;
    }
  >();
  private cloudLogGapReconciler: CloudLogGapReconciler;
  /** Maps toolCallId → cloud requestId for routing permission responses */
  private cloudPermissionRequestIds = new Map<string, string>();
  private liveTurnContent = new Map<
    string,
    { startedAtTs: number; agentTextChunks: number; agentOutputEvents: number }
  >();
  private idleKilledSubscription: { unsubscribe: () => void } | null = null;
  /**
   * Cached preview-config-options responses keyed by `${apiHost}::${adapter}`.
   * Shared across cloud sessions so switching model/adapter reuses the list.
   */
  private previewConfigOptionsCache = new Map<
    string,
    { promise: Promise<SessionConfigOption[]>; fetchedAt: number }
  >();
  /**
   * Initial cloud prompt text (user message + any channel CONTEXT.md block),
   * stashed by task creation keyed by taskId. The cloud sandbox takes seconds to
   * boot and echo this back, so the optimistic placeholder would otherwise show
   * the bare task description with no CONTEXT.md chip until the echo lands. Seed
   * the placeholder with this richer text instead, then drop it once consumed.
   */
  private initialCloudOptimisticPrompt = new Map<string, string>();

  constructor(private readonly d: SessionServiceDeps) {
    this.cloudRunIdleTracker = new CloudRunIdleTracker();
    this.cloudLogGapReconciler = new CloudLogGapReconciler({
      fetchLogs: (logUrl, taskRunId, minEntryCount) =>
        this.fetchSessionLogs(logUrl, taskRunId, { minEntryCount }),
      getSession: (taskRunId) => {
        const session = d.store.getSessions()[taskRunId];
        if (!session) return undefined;
        return {
          taskId: session.taskId,
          processedLineCount: session.processedLineCount ?? 0,
          logUrl: session.logUrl,
        };
      },
      commit: (taskRunId, rawEntries, logUrl, processedLineCount) =>
        this.commitReconciledCloudEvents(
          taskRunId,
          rawEntries,
          logUrl,
          processedLineCount,
        ),
      logger: d.log,
    });
    this.idleKilledSubscription = d.trpc.agent.onSessionIdleKilled.subscribe(
      undefined,
      {
        onData: (event: { taskRunId: string }) => {
          const { taskRunId } = event;
          d.log.info("Session idle-killed by main process", { taskRunId });
          this.handleIdleKill(taskRunId);
        },
        onError: (err: unknown) => {
          d.log.debug("Idle-killed subscription error", { error: err });
        },
      },
    );
  }

  /**
   * Connect to a task session.
   * Uses locking to prevent duplicate concurrent connections.
   */
  async connectToTask(params: ConnectParams): Promise<void> {
    const { task } = params;
    const taskId = task.id;
    this.localRepoPaths.set(taskId, params.repoPath);

    // Return existing connection promise if already connecting
    const existingPromise = this.connectingTasks.get(taskId);
    if (existingPromise) {
      return existingPromise;
    }

    // Check for existing connected session
    const existingSession = this.d.store.getSessionByTaskId(taskId);
    if (existingSession?.status === "connected") {
      this.d.log.info("Already connected to task", { taskId });
      return;
    }
    if (existingSession?.status === "connecting") {
      this.d.log.info("Session already in connecting state", { taskId });
      return;
    }

    // Create and store the connection promise
    const connectPromise = this.doConnect(params).finally(() => {
      this.connectingTasks.delete(taskId);
    });
    this.connectingTasks.set(taskId, connectPromise);

    return connectPromise;
  }

  private async doConnect(params: ConnectParams): Promise<void> {
    const {
      task,
      repoPath,
      initialPrompt,
      executionMode,
      adapter,
      model,
      reasoningLevel,
    } = params;
    const { id: taskId, latest_run: latestRun } = task;
    const taskTitle = task.title || task.description || "Task";

    if (latestRun?.environment === "cloud") {
      this.d.log.info("Skipping local session connect for cloud run", {
        taskId,
        taskRunId: latestRun.id,
      });
      return;
    }

    try {
      const authStatus = await this.getAuthCredentialsStatus();
      if (authStatus.kind === "restoring") {
        throw new Error("Authentication is still restoring. Please wait.");
      }
      const auth = authStatus.kind === "ready" ? authStatus.auth : null;
      const route = routeLocalConnect({
        hasAuth: auth !== null,
        latestRunId: latestRun?.id,
        latestRunLogUrl: latestRun?.log_url,
      });

      if (route.kind === "no-auth" || !auth) {
        this.d.log.error("Missing auth credentials");
        const taskRunId = latestRun?.id ?? `error-${taskId}`;
        const session = createBaseSession(taskRunId, taskId, taskTitle);
        session.status = "error";
        session.errorMessage =
          "Authentication required. Please sign in to continue.";
        if (initialPrompt?.length) {
          session.initialPrompt = initialPrompt;
        }
        this.d.store.setSession(session);
        return;
      }

      if (route.kind === "resume-existing") {
        const { taskRunId: existingRunId, logUrl } = route;
        if (!this.d.getIsOnline()) {
          this.d.log.info("Skipping connection attempt - offline", { taskId });
          const { rawEntries } = await this.fetchSessionLogs(
            logUrl,
            existingRunId,
          );
          const events = convertStoredEntriesToEvents(rawEntries);
          const session = createBaseSession(existingRunId, taskId, taskTitle);
          session.events = events;
          session.logUrl = logUrl;
          session.status = "disconnected";
          session.errorMessage = OFFLINE_SESSION_MESSAGE;
          this.d.store.setSession(session);
          return;
        }

        const [workspaceResult, logResult] = await Promise.all([
          this.d.trpc.workspace.verify.query({ taskId }),
          this.fetchSessionLogs(logUrl, existingRunId),
        ]);

        if (!workspaceResult.exists) {
          this.d.log.warn("Workspace no longer exists, showing error state", {
            taskId,
            missingPath: workspaceResult.missingPath,
          });
          const events = convertStoredEntriesToEvents(logResult.rawEntries);
          const session = createBaseSession(existingRunId, taskId, taskTitle);
          session.events = events;
          session.logUrl = logUrl;
          session.status = "error";
          session.errorMessage = workspaceResult.missingPath
            ? `Working directory no longer exists: ${workspaceResult.missingPath}`
            : "The working directory for this task no longer exists. Please start a new session.";
          this.d.store.setSession(session);
          return;
        }

        await this.reconnectToLocalSession(
          taskId,
          existingRunId,
          taskTitle,
          logUrl,
          repoPath,
          auth,
          logResult,
        );
      } else {
        if (!this.d.getIsOnline()) {
          this.d.log.info("Skipping connection attempt - offline", { taskId });
          const taskRunId = latestRun?.id ?? `offline-${taskId}`;
          const session = createBaseSession(taskRunId, taskId, taskTitle);
          session.status = "disconnected";
          session.errorMessage =
            "No internet connection. Connect when you're back online.";
          this.d.store.setSession(session);
          return;
        }

        await this.createNewLocalSession(
          taskId,
          taskTitle,
          repoPath,
          auth,
          initialPrompt,
          executionMode,
          adapter,
          model,
          reasoningLevel,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.d.log.error("Failed to connect to task", { message });

      const taskRunId = latestRun?.id ?? `error-${taskId}`;
      const session = createBaseSession(taskRunId, taskId, taskTitle);
      if (initialPrompt?.length) {
        session.initialPrompt = initialPrompt;
      }
      if (latestRun?.log_url) {
        try {
          const { rawEntries } = await this.fetchSessionLogs(
            latestRun.log_url,
            latestRun.id,
          );
          session.events = convertStoredEntriesToEvents(rawEntries);
          session.logUrl = latestRun.log_url;
        } catch {
          // Ignore log fetch errors
        }
      }

      const shouldAutoRetry = this.d.getIsOnline();
      session.status = shouldAutoRetry ? "connecting" : "error";
      if (!shouldAutoRetry) {
        session.errorTitle = "Failed to connect";
        session.errorMessage = message;
      }
      this.d.store.setSession(session);

      if (!shouldAutoRetry) return;

      let lastRetryMessage = message;
      let wentOffline = false;
      let restoringWaits = 0;
      let attempt = 0;
      while (attempt < AUTO_RETRY_MAX_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, AUTO_RETRY_DELAY_MS),
        );
        if (!this.d.getIsOnline()) {
          this.d.log.warn("Skipping retry — device went offline", { taskId });
          wentOffline = true;
          break;
        }

        // Wait out an in-flight restore instead of spending a retry on
        // clearSessionError, which tears the connecting session down.
        if (
          restoringWaits < AUTH_RESTORE_MAX_RETRY_WAITS &&
          (await this.getAuthCredentialsStatus()).kind === "restoring"
        ) {
          restoringWaits++;
          this.d.log.info("Auth still restoring; keeping session connecting", {
            taskId,
            restoringWaits,
          });
          continue;
        }

        attempt++;
        this.d.log.warn("Auto-retrying failed connection", {
          taskId,
          attempt,
          delayMs: AUTO_RETRY_DELAY_MS,
        });
        try {
          await this.clearSessionError(taskId, repoPath);
          return;
        } catch (retryError) {
          lastRetryMessage =
            retryError instanceof Error
              ? retryError.message
              : String(retryError);
          this.d.log.error("Auto-retry via clearSessionError failed", {
            taskId,
            attempt,
            error: lastRetryMessage,
          });
        }
      }

      const currentSession = this.d.store.getSessionByTaskId(taskId);
      if (!currentSession) return;
      this.d.store.updateSession(
        currentSession.taskRunId,
        computeAutoRetryFinalState({
          wentOffline,
          lastRetryMessage,
          originalMessage: message,
        }),
      );
    }
  }

  private async reconnectToLocalSession(
    taskId: string,
    taskRunId: string,
    taskTitle: string,
    logUrl: string | undefined,
    repoPath: string,
    auth: AuthCredentials,
    prefetchedLogs?: {
      rawEntries: StoredLogEntry[];
      sessionId?: string;
      adapter?: Adapter;
    },
  ): Promise<boolean> {
    const { rawEntries, sessionId, adapter } =
      prefetchedLogs ?? (await this.fetchSessionLogs(logUrl, taskRunId));
    const events = convertStoredEntriesToEvents(rawEntries);

    const storedAdapter = this.d.adapterStore.getAdapter(taskRunId);
    const resolvedAdapter = adapter ?? storedAdapter;
    const persistedConfigOptions = this.d.getPersistedConfigOptions(taskRunId);

    const previous = this.d.store.getSessions()[taskRunId];

    const session = createBaseSession(taskRunId, taskId, taskTitle);
    session.events = events;
    if (logUrl) {
      session.logUrl = logUrl;
    }
    if (persistedConfigOptions) {
      session.configOptions = persistedConfigOptions;
    }
    if (resolvedAdapter) {
      session.adapter = resolvedAdapter;
      this.d.adapterStore.setAdapter(taskRunId, resolvedAdapter);
    }

    if (previous) {
      session.optimisticItems = previous.optimisticItems;
      session.messageQueue = previous.messageQueue;
      session.isPromptPending = previous.isPromptPending;
      session.promptStartedAt = previous.promptStartedAt;
      session.pausedDurationMs = previous.pausedDurationMs;
    }

    this.d.store.setSession(session);
    this.subscribeToChannel(taskRunId);

    try {
      const modeOpt = getConfigOptionByCategory(persistedConfigOptions, "mode");
      const persistedMode =
        modeOpt?.type === "select" ? modeOpt.currentValue : undefined;

      // Resumed SDK sessions don't remember the model — without this the
      // session silently falls back to the default model on every reconnect.
      const modelOpt = getConfigOptionByCategory(
        persistedConfigOptions,
        "model",
      );
      const persistedModel =
        modelOpt?.type === "select" ? modelOpt.currentValue : undefined;

      this.d.trpc.workspace.verify
        .query({ taskId })
        .then((workspaceResult) => {
          if (!workspaceResult.exists) {
            this.d.log.warn("Workspace no longer exists", {
              taskId,
              missingPath: workspaceResult.missingPath,
            });
            this.d.store.updateSession(taskRunId, {
              status: "error",
              errorMessage: workspaceResult.missingPath
                ? `Working directory no longer exists: ${workspaceResult.missingPath}`
                : "The working directory for this task no longer exists. Please start a new session.",
            });
          }
        })
        .catch((err) => {
          this.d.log.warn("Failed to verify workspace", { taskId, err });
        });

      const { customInstructions } = this.d.settings;
      const result = await this.d.trpc.agent.reconnect.mutate({
        taskId,
        taskRunId,
        repoPath,
        apiHost: auth.apiHost,
        projectId: auth.projectId,
        logUrl,
        sessionId,
        adapter: resolvedAdapter,
        permissionMode: persistedMode,
        model: persistedModel,
        customInstructions: customInstructions || undefined,
      });

      if (result) {
        // Cast and merge live configOptions with persisted values.
        // Fall back to persisted options if the agent doesn't return any
        // (e.g. after session compaction).
        let configOptions = result.configOptions as
          | SessionConfigOption[]
          | undefined;
        if (configOptions && persistedConfigOptions) {
          configOptions = mergeConfigOptions(
            configOptions,
            persistedConfigOptions,
          );
        } else if (!configOptions) {
          configOptions = persistedConfigOptions ?? undefined;
        }

        this.d.store.updateSession(taskRunId, {
          status: "connected",
          configOptions,
        });

        // Persist the merged config options
        if (configOptions) {
          this.d.setPersistedConfigOptions(taskRunId, configOptions);
        }

        // Restore persisted config options to server in parallel
        if (persistedConfigOptions) {
          await Promise.all(
            persistedConfigOptions.map((opt) =>
              this.d.trpc.agent.setConfigOption
                .mutate({
                  sessionId: taskRunId,
                  configId: opt.id,
                  value: String(opt.currentValue),
                })
                .catch((error) => {
                  this.d.log.warn(
                    "Failed to restore persisted config option after reconnect",
                    {
                      taskId,
                      configId: opt.id,
                      error,
                    },
                  );
                }),
            ),
          );
        }
        return true;
      } else {
        this.d.log.warn("Reconnect returned null", { taskId, taskRunId });
        this.setErrorSession(
          taskId,
          taskRunId,
          taskTitle,
          "Session could not be resumed. Please retry or start a new session.",
        );
        return false;
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.d.log.warn("Reconnect failed", { taskId, error: errorMessage });
      this.setErrorSession(
        taskId,
        taskRunId,
        taskTitle,
        errorMessage ||
          "Failed to reconnect. Please retry or start a new session.",
      );
      return false;
    }
  }

  private async teardownSession(taskRunId: string): Promise<void> {
    const session = this.getSessionByRunId(taskRunId);

    try {
      await this.d.trpc.agent.cancel.mutate({ sessionId: taskRunId });
    } catch (error) {
      this.d.log.debug(
        "Cancel during teardown failed (session may already be gone)",
        {
          taskRunId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }

    this.unsubscribeFromChannel(taskRunId);
    this.d.store.removeSession(taskRunId);
    this.cloudRunIdleTracker.delete(taskRunId);
    this.cloudLogGapReconciler.forgetDeficiency(taskRunId);
    if (session) {
      this.localRepoPaths.delete(session.taskId);
      this.localRecoveryAttempts.delete(session.taskId);
    }
    this.d.adapterStore.removeAdapter(taskRunId);
    this.d.removePersistedConfigOptions(taskRunId);
  }

  /**
   * Handle an idle-kill from the main process without destroying session state.
   * The main process already cleaned up the agent, so we only need to
   * unsubscribe from the channel and mark the session as errored.
   * Preserves events, logUrl, configOptions and adapter so that Retry
   * can reconnect with full context via resumeSession.
   */
  private handleIdleKill(taskRunId: string): void {
    this.unsubscribeFromChannel(taskRunId);
    this.d.store.updateSession(taskRunId, {
      status: "error",
      errorMessage: "Session disconnected due to inactivity. Reconnecting…",
      isPromptPending: false,
      isCompacting: false,
      promptStartedAt: null,
      idleKilled: true,
    });
  }

  private setErrorSession(
    taskId: string,
    taskRunId: string,
    taskTitle: string,
    errorMessage: string,
    errorTitle?: string,
  ): void {
    // Preserve events and logUrl from the existing session so the
    // retry / reset flows can re-hydrate without a fresh log fetch.
    // Note: the error overlay is opaque, so these events aren't visible
    // to the user — they're carried forward for the next reconnect attempt.
    const existing = this.d.store.getSessionByTaskId(taskId);
    const session = createBaseSession(taskRunId, taskId, taskTitle);
    session.status = "error";
    session.errorTitle = errorTitle;
    session.errorMessage = errorMessage;
    if (existing?.events?.length) {
      session.events = existing.events;
    }
    if (existing?.logUrl) {
      session.logUrl = existing.logUrl;
    }
    if (existing?.initialPrompt?.length) {
      session.initialPrompt = existing.initialPrompt;
    }
    this.d.store.setSession(session);
  }

  private async tryAutoRecoverLocalSession(
    taskId: string,
    taskRunId: string,
    reason: string,
  ): Promise<boolean> {
    const existingRecovery = this.localRecoveryAttempts.get(taskId);
    if (existingRecovery) {
      return existingRecovery;
    }

    const recoveryPromise = this.runAutoRecoverLocalSession(
      taskId,
      taskRunId,
      reason,
    ).finally(() => {
      this.localRecoveryAttempts.delete(taskId);
    });

    this.localRecoveryAttempts.set(taskId, recoveryPromise);
    return recoveryPromise;
  }

  private async runAutoRecoverLocalSession(
    taskId: string,
    taskRunId: string,
    reason: string,
  ): Promise<boolean> {
    const repoPath = this.localRepoPaths.get(taskId);
    const session = this.d.store.getSessionByTaskId(taskId);
    if (!repoPath || !session || session.isCloud) {
      return false;
    }

    this.d.log.warn("Attempting automatic local session recovery", {
      taskId,
      taskRunId,
      reason,
    });

    this.d.store.updateSession(taskRunId, {
      status: "disconnected",
      errorTitle: undefined,
      errorMessage: LOCAL_SESSION_RECOVERY_MESSAGE,
      isPromptPending: false,
      isCompacting: false,
      promptStartedAt: null,
    });

    for (
      let attempt = 0;
      attempt < LOCAL_SESSION_RECONNECT_ATTEMPTS;
      attempt++
    ) {
      const currentSession = this.d.store.getSessionByTaskId(taskId);
      if (!currentSession || currentSession.taskRunId !== taskRunId) {
        return false;
      }

      if (attempt > 0) {
        const delay = getBackoffDelay(
          attempt - 1,
          LOCAL_SESSION_RECONNECT_BACKOFF,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      const recovered = await this.reconnectInPlace(taskId, repoPath);
      if (recovered) {
        this.d.log.info("Automatic local session recovery succeeded", {
          taskId,
          taskRunId,
          attempt: attempt + 1,
        });
        return true;
      }
    }

    const latestSession = this.d.store.getSessionByTaskId(taskId);
    if (latestSession?.taskRunId === taskRunId) {
      this.setErrorSession(
        taskId,
        taskRunId,
        latestSession.taskTitle,
        LOCAL_SESSION_RECOVERY_FAILED_MESSAGE,
        "Connection lost",
      );
    }

    this.d.log.warn("Automatic local session recovery exhausted", {
      taskId,
      taskRunId,
    });

    return false;
  }

  private startAutoRecoverLocalSession(
    taskId: string,
    taskRunId: string,
    taskTitle: string,
    reason: string,
    fallbackMessage: string,
  ): void {
    void this.tryAutoRecoverLocalSession(taskId, taskRunId, reason).then(
      (recovered) => {
        if (recovered) {
          return;
        }

        const latestSession = this.d.store.getSessionByTaskId(taskId);
        if (!latestSession || latestSession.taskRunId !== taskRunId) {
          return;
        }

        if (latestSession.status !== "error") {
          this.setErrorSession(
            taskId,
            taskRunId,
            taskTitle,
            fallbackMessage,
            "Connection lost",
          );
        }
      },
    );
  }

  private async createNewLocalSession(
    taskId: string,
    taskTitle: string,
    repoPath: string,
    auth: AuthCredentials,
    initialPrompt?: ContentBlock[],
    executionMode?: ExecutionMode,
    adapter?: "claude" | "codex",
    model?: string,
    reasoningLevel?: string,
  ): Promise<void> {
    const { client } = auth;
    if (!client) {
      throw new Error("Unable to reach server. Please check your connection.");
    }

    const taskRun = await client.createTaskRun(taskId);
    if (!taskRun?.id) {
      throw new Error("Failed to create task run. Please try again.");
    }

    const { customInstructions: startCustomInstructions } = this.d.settings;
    const preferredModel = model ?? this.d.DEFAULT_GATEWAY_MODEL;
    const result = await this.d.trpc.agent.start.mutate({
      taskId,
      taskRunId: taskRun.id,
      repoPath,
      apiHost: auth.apiHost,
      projectId: auth.projectId,
      permissionMode: executionMode,
      adapter,
      customInstructions: startCustomInstructions || undefined,
      effort: effortLevelSchema.safeParse(reasoningLevel).success
        ? (reasoningLevel as EffortLevel)
        : undefined,
      model: preferredModel,
    });

    const session = createBaseSession(taskRun.id, taskId, taskTitle);
    session.channel = result.channel;
    session.status = "connected";
    session.adapter = adapter;
    const configOptions = result.configOptions as
      | SessionConfigOption[]
      | undefined;
    session.configOptions = configOptions;

    // Persist the config options
    if (configOptions) {
      this.d.setPersistedConfigOptions(taskRun.id, configOptions);
    }

    // Persist the adapter
    if (adapter) {
      this.d.adapterStore.setAdapter(taskRun.id, adapter);
    }

    // Store the initial prompt on the session so retry/reset flows can
    // re-send it if the session errors after this point (e.g. subscription
    // error, agent crash, or prompt failure).
    if (initialPrompt?.length) {
      session.initialPrompt = initialPrompt;
    }

    this.d.store.setSession(session);
    this.subscribeToChannel(taskRun.id);

    this.d.track(ANALYTICS_EVENTS.TASK_RUN_STARTED, {
      task_id: taskId,
      execution_type: "local",
      initial_mode: executionMode,
      adapter,
    });

    if (initialPrompt?.length) {
      await this.sendPrompt(taskId, initialPrompt);
    }
  }

  async loadLogsOnly(params: {
    taskId: string;
    taskRunId: string;
    taskTitle: string;
    logUrl: string;
  }): Promise<void> {
    const { taskId, taskRunId, taskTitle, logUrl } = params;
    const existing = this.d.store.getSessionByTaskId(taskId);
    if (existing && existing.events.length > 0) return;

    const { rawEntries } = await this.fetchSessionLogs(logUrl, taskRunId);
    const events = convertStoredEntriesToEvents(rawEntries);
    const session = createBaseSession(taskRunId, taskId, taskTitle);
    session.events = events;
    session.logUrl = logUrl;
    session.status = "disconnected";
    this.d.store.setSession(session);
  }

  async disconnectFromTask(taskId: string): Promise<void> {
    const session = this.d.store.getSessionByTaskId(taskId);
    if (!session) return;

    await this.teardownSession(session.taskRunId);
  }

  // --- Subscription Management ---

  private subscribeToChannel(taskRunId: string): void {
    if (this.subscriptions.has(taskRunId)) {
      return;
    }

    const eventSubscription = this.d.trpc.agent.onSessionEvent.subscribe(
      { taskRunId },
      {
        onData: (payload: unknown) => {
          this.handleSessionEvent(taskRunId, payload as AcpMessage);
        },
        onError: (err) => {
          this.d.log.error("Session subscription error", {
            taskRunId,
            error: err,
          });
          const session = this.getSessionByRunId(taskRunId);
          if (!session || session.isCloud) {
            this.d.store.updateSession(taskRunId, {
              status: "error",
              errorMessage:
                "Lost connection to the agent. Please restart the task.",
            });
            return;
          }

          this.startAutoRecoverLocalSession(
            session.taskId,
            taskRunId,
            session.taskTitle,
            "subscription_error",
            "Lost connection to the agent. Please retry or start a new session.",
          );
        },
      },
    );

    const permissionSubscription =
      this.d.trpc.agent.onPermissionRequest.subscribe(
        { taskRunId },
        {
          onData: async (payload) => {
            this.handlePermissionRequest(taskRunId, payload);
          },
          onError: (err) => {
            this.d.log.error("Permission subscription error", {
              taskRunId,
              error: err,
            });
          },
        },
      );

    this.subscriptions.set(taskRunId, {
      event: eventSubscription,
      permission: permissionSubscription,
    });
  }

  private unsubscribeFromChannel(taskRunId: string): void {
    const subscription = this.subscriptions.get(taskRunId);
    subscription?.event.unsubscribe();
    subscription?.permission?.unsubscribe();
    this.subscriptions.delete(taskRunId);
    this.liveTurnContent.delete(taskRunId);
  }

  /**
   * Reset all service state and clean up subscriptions.
   * Called on logout or app reset.
   */
  reset(): void {
    this.d.log.info("Resetting session service", {
      subscriptionCount: this.subscriptions.size,
      connectingCount: this.connectingTasks.size,
      cloudWatcherCount: this.cloudTaskWatchers.size,
    });

    // Unsubscribe from all active subscriptions
    for (const taskRunId of this.subscriptions.keys()) {
      this.unsubscribeFromChannel(taskRunId);
    }

    // Clean up all cloud task watchers
    for (const taskId of [...this.cloudTaskWatchers.keys()]) {
      this.stopCloudTaskWatch(taskId);
    }

    this.connectingTasks.clear();
    this.localRepoPaths.clear();
    this.localRecoveryAttempts.clear();
    this.cloudPermissionRequestIds.clear();
    this.liveTurnContent.clear();
    this.cloudLogGapReconciler.clear();
    this.dispatchingCloudQueues.clear();
    this.scheduledCloudQueueFlushes.clear();
    this.cloudRunIdleTracker.clear();
    this.idleKilledSubscription?.unsubscribe();
    this.idleKilledSubscription = null;
  }

  /**
   * A steer message rides on `session/prompt` with `_meta.steer`. It is folded
   * into the running turn, so its request must not participate in turn-state
   * bookkeeping (currentPromptId / isPromptPending) or the live turn would be
   * cut short. Its response carries a foreign request id, so the currentPromptId
   * guard ignores it without needing a marker here.
   */
  private isSteerMessage(msg: AcpMessage["message"]): boolean {
    if (isJsonRpcRequest(msg) && msg.method === "session/prompt") {
      const params = msg.params as { _meta?: { steer?: boolean } } | undefined;
      return params?._meta?.steer === true;
    }
    return false;
  }

  private finalizeTurnContent(
    taskRunId: string,
    trigger: "stop_reason" | "turn_complete",
    endedAtTs: number,
  ): void {
    const tally = this.liveTurnContent.get(taskRunId);
    if (!tally) return;
    this.liveTurnContent.delete(taskRunId);
    const session = this.d.store.getSessions()[taskRunId];
    const payload = {
      taskRunId,
      taskId: session?.taskId,
      isCloud: session?.isCloud ?? false,
      trigger,
      agentTextChunks: tally.agentTextChunks,
      agentOutputEvents: tally.agentOutputEvents,
      durationMs: Math.max(0, endedAtTs - tally.startedAtTs),
    };
    if (tally.agentTextChunks === 0 && tally.agentOutputEvents === 0) {
      this.d.log.warn("Turn completed with no agent output", payload);
    } else {
      this.d.log.debug("Turn completed", payload);
    }
  }

  private updatePromptStateFromEvents(
    taskRunId: string,
    events: AcpMessage[],
    { isLive = false }: { isLive?: boolean } = {},
  ): void {
    for (const acpMsg of events) {
      const msg = acpMsg.message;
      // A steer is injected into the running turn, not a turn of its own. Skip
      // its request so it never claims currentPromptId. Otherwise the steer's
      // instant response would clear the live turn's pending state.
      if (this.isSteerMessage(msg)) {
        continue;
      }
      const turnTally = isLive
        ? this.liveTurnContent.get(taskRunId)
        : undefined;
      if (turnTally) {
        const kind = classifyTurnEventKind(msg);
        if (kind === "text") turnTally.agentTextChunks += 1;
        else if (kind === "output") turnTally.agentOutputEvents += 1;
      }
      if (isJsonRpcRequest(msg) && msg.method === "session/prompt") {
        this.d.store.updateSession(taskRunId, {
          isPromptPending: true,
          promptStartedAt: acpMsg.ts,
          pausedDurationMs: 0,
          currentPromptId: msg.id,
        });
        if (isLive) {
          this.liveTurnContent.set(taskRunId, {
            startedAtTs: acpMsg.ts,
            agentTextChunks: 0,
            agentOutputEvents: 0,
          });
        }
        const promptSession = this.d.store.getSessions()[taskRunId];
        if (promptSession?.isCloud) {
          this.cloudRunIdleTracker.markBusy(promptSession);
          if (promptSession.agentIdleForRunId) {
            this.d.store.updateSession(taskRunId, {
              agentIdleForRunId: undefined,
            });
          }
        }
      }
      if (
        "id" in msg &&
        "result" in msg &&
        typeof msg.result === "object" &&
        msg.result !== null &&
        "stopReason" in msg.result
      ) {
        // Only clear pending state if this response matches the currently
        // in-flight prompt. A late response from a previously cancelled turn
        // must not be allowed to mark a newer turn as done.
        const session = this.d.store.getSessions()[taskRunId];
        if (session && session.currentPromptId !== msg.id) {
          continue;
        }
        this.d.store.updateSession(taskRunId, {
          isPromptPending: false,
          promptStartedAt: null,
          currentPromptId: null,
        });
        if (isLive) {
          this.finalizeTurnContent(taskRunId, "stop_reason", acpMsg.ts);
        }
      }
      if (isTurnCompleteEvent(acpMsg)) {
        // Local sessions use the JSON-RPC response as the canonical turn-done
        // signal; clearing currentPromptId here would race the id-match guard
        // above. Cloud sessions never see that response.
        const session = this.getSessionByRunId(taskRunId);
        if (session?.isCloud) {
          this.d.store.updateSession(taskRunId, {
            isPromptPending: false,
            promptStartedAt: null,
            currentPromptId: null,
          });
          if (isLive) {
            // Queued messages will start a new turn — suppress the "done" notification in that case.
            if (session.messageQueue.length === 0) {
              this.d.notifyPromptComplete(
                session.taskTitle,
                "end_turn",
                session.taskId,
              );
            }
            this.d.taskViewedApi.markActivity(session.taskId);
            this.finalizeTurnContent(taskRunId, "turn_complete", acpMsg.ts);
          }
        }
      }
      // Lifecycle handshake from the agent — flip status to "connected"
      // so the UI can release the queue-while-not-ready guard. This is
      // the explicit "agent is up and accepting user messages" signal,
      // emitted by `agent-server.ts` once the ACP session is fully
      // wired. We deliberately do NOT drain the queue here: the agent
      // is about to start `sendInitialTaskMessage` (or `sendResumeMessage`),
      // and dispatching a queued user_message right now would race with
      // its `clientConnection.prompt()` and one of the prompts would end
      // up cancelled. The `turn_complete` handler below drains once the
      // agent's initial / resume turn is actually finished.
      if (
        "method" in msg &&
        isNotification(msg.method, POSTHOG_NOTIFICATIONS.RUN_STARTED)
      ) {
        const session = this.d.store.getSessions()[taskRunId];
        const params = (msg as { params?: { agentVersion?: unknown } }).params;
        const agentVersion =
          typeof params?.agentVersion === "string"
            ? params.agentVersion
            : undefined;
        const updates: Partial<AgentSession> = {};
        if (agentVersion && session?.agentVersion !== agentVersion) {
          updates.agentVersion = agentVersion;
        }
        if (session?.isCloud && session.status !== "connected") {
          updates.status = "connected";
        }
        if (Object.keys(updates).length > 0) {
          this.d.store.updateSession(taskRunId, updates);
        }
      }
      // Canonical "turn boundary" — flush any queued cloud messages now
      // that the agent is idle and accepting the next prompt.
      if (
        "method" in msg &&
        isNotification(msg.method, POSTHOG_NOTIFICATIONS.TURN_COMPLETE)
      ) {
        const session = this.d.store.getSessions()[taskRunId];
        if (session?.isCloud) {
          // Backward compat: treat turn_complete as an implicit run_started
          // for agents that predate the run_started notification. The turn
          // finished, so the agent is idle for this run, lets a later
          // transport drop recover readiness.
          const updates: Partial<AgentSession> = {};
          if (session.status !== "connected") {
            updates.status = "connected";
          }
          if (session.agentIdleForRunId !== taskRunId) {
            updates.agentIdleForRunId = taskRunId;
          }
          if (Object.keys(updates).length > 0) {
            this.d.store.updateSession(taskRunId, updates);
          }
          this.cloudRunIdleTracker.markIdle(session);
          if (session.messageQueue.length > 0) {
            this.scheduleCloudQueueFlush(session.taskId, "turn_complete");
          }
        }
      }
    }
  }

  private handleSessionEvent(taskRunId: string, acpMsg: AcpMessage): void {
    const session = this.d.store.getSessions()[taskRunId];
    if (!session) return;

    const isUserPromptEcho =
      isJsonRpcRequest(acpMsg.message) &&
      acpMsg.message.method === "session/prompt";

    // Once the agent starts responding, clear initialPrompt so that
    // retry reconnects to this session instead of creating a new one.
    if (!isUserPromptEcho && session.initialPrompt?.length) {
      this.d.store.updateSession(taskRunId, {
        initialPrompt: undefined,
      });
    }

    if (isUserPromptEcho) {
      this.d.store.replaceOptimisticWithEvent(taskRunId, acpMsg);
    } else {
      this.d.store.appendEvents(taskRunId, [acpMsg]);
    }
    this.updatePromptStateFromEvents(taskRunId, [acpMsg], { isLive: true });

    const msg = acpMsg.message;

    if (
      "id" in msg &&
      "result" in msg &&
      typeof msg.result === "object" &&
      msg.result !== null &&
      "stopReason" in msg.result
    ) {
      // Ignore responses that don't match the currently in-flight prompt id.
      // A late response from a cancelled prior turn must not drain the queue
      // or fire the "prompt complete" notification for the newer turn.
      // We check against `session` (captured at the top of this function, pre-update),
      // because updatePromptStateFromEvents above already cleared currentPromptId
      // for a valid match — re-reading from the store would lose the distinction
      // between "valid match just cleared" and "no turn was in flight".
      if (session.currentPromptId !== msg.id) {
        return;
      }

      const stopReason = (msg.result as { stopReason?: string }).stopReason;
      const hasQueuedMessages = this.drainQueuedMessages(taskRunId, session);

      // Only notify when queue is empty - queued messages will start a new turn
      if (stopReason && !hasQueuedMessages) {
        this.d.notifyPromptComplete(
          session.taskTitle,
          stopReason,
          session.taskId,
        );
      }

      this.d.taskViewedApi.markActivity(session.taskId);
    }

    if ("method" in msg && msg.method === "session/update" && "params" in msg) {
      const params = msg.params as {
        update?: {
          sessionUpdate?: string;
          configOptions?: SessionConfigOption[];
        };
      };

      // Handle config option updates (replaces current_mode_update)
      if (
        params?.update?.sessionUpdate === "config_option_update" &&
        params.update.configOptions
      ) {
        const configOptions = params.update.configOptions;
        this.d.store.updateSession(taskRunId, {
          configOptions,
        });
        // Persist the updated config options
        this.d.setPersistedConfigOptions(taskRunId, configOptions);
        this.d.log.info("Session config options updated", { taskRunId });
      }

      // Handle context usage updates
      if (params?.update?.sessionUpdate === "usage_update") {
        const update = params.update as {
          used?: number;
          size?: number;
        };
        if (
          typeof update.used === "number" &&
          typeof update.size === "number"
        ) {
          this.d.store.updateSession(taskRunId, {
            contextUsed: update.used,
            contextSize: update.size,
          });
        }
      }
    }

    // Handle SDK_SESSION notifications for adapter info
    if (
      "method" in msg &&
      isNotification(msg.method, POSTHOG_NOTIFICATIONS.SDK_SESSION) &&
      "params" in msg
    ) {
      const params = msg.params as {
        adapter?: Adapter;
      };
      if (params?.adapter) {
        this.d.store.updateSession(taskRunId, {
          adapter: params.adapter,
        });
        this.d.adapterStore.setAdapter(taskRunId, params.adapter);
      }
    }

    if (
      "method" in msg &&
      "params" in msg &&
      isNotification(msg.method, POSTHOG_NOTIFICATIONS.STATUS)
    ) {
      const params = msg.params as { status?: string; isComplete?: boolean };
      if (params?.status === "compacting") {
        this.d.store.updateSession(taskRunId, {
          isCompacting: !params.isComplete,
        });
      }
    }

    if (
      "method" in msg &&
      isNotification(msg.method, POSTHOG_NOTIFICATIONS.COMPACT_BOUNDARY)
    ) {
      this.d.store.updateSession(taskRunId, {
        isCompacting: false,
      });

      this.drainQueuedMessages(taskRunId, session);
    }
  }

  private drainQueuedMessages(
    taskRunId: string,
    session: AgentSession,
  ): boolean {
    const freshSession = this.d.store.getSessions()[taskRunId];
    const hasQueuedMessages =
      freshSession &&
      freshSession.messageQueue.length > 0 &&
      freshSession.status === "connected";

    if (hasQueuedMessages) {
      setTimeout(() => {
        this.sendQueuedMessages(session.taskId).catch((err) => {
          this.d.log.error("Failed to send queued messages", {
            taskId: session.taskId,
            error: err,
          });
        });
      }, 0);
    }

    return hasQueuedMessages;
  }

  private handlePermissionRequest(
    taskRunId: string,
    payload: Omit<RequestPermissionRequest, "sessionId"> & {
      taskRunId: string;
    },
  ): void {
    this.d.log.info("Permission request received in renderer", {
      taskRunId,
      toolCallId: payload.toolCall.toolCallId,
      title: payload.toolCall.title,
    });

    // Get fresh session state
    const session = this.d.store.getSessions()[taskRunId];
    if (!session) {
      this.d.log.warn("Session not found for permission request", {
        taskRunId,
      });
      return;
    }

    const newPermissions = new Map(session.pendingPermissions);
    // Add receivedAt to create PermissionRequest
    newPermissions.set(payload.toolCall.toolCallId, {
      ...payload,
      receivedAt: Date.now(),
    });

    this.d.store.setPendingPermissions(taskRunId, newPermissions);
    this.d.taskViewedApi.markActivity(session.taskId);
    this.d.notifyPermissionRequest(session.taskTitle, session.taskId);
  }

  private handleCloudPermissionRequest(
    taskRunId: string,
    update: DerivedPermissionRequest,
  ): void {
    this.d.log.info("Cloud permission request received", {
      taskRunId,
      requestId: update.requestId,
      toolCallId: update.toolCall.toolCallId,
      title: update.toolCall.title,
    });

    const session = this.d.store.getSessions()[taskRunId];
    if (!session) {
      this.d.log.warn("Session not found for cloud permission request", {
        taskRunId,
      });
      return;
    }

    if (
      isPermissionRequestAlreadySurfaced(
        session.pendingPermissions,
        this.cloudPermissionRequestIds.get(update.toolCall.toolCallId),
        update,
      )
    ) {
      return;
    }

    // Store the cloud requestId so we can route the response back
    this.cloudPermissionRequestIds.set(
      update.toolCall.toolCallId,
      update.requestId,
    );

    const newPermissions = new Map(session.pendingPermissions);
    newPermissions.set(update.toolCall.toolCallId, {
      toolCall: update.toolCall as PermissionRequest["toolCall"],
      options: update.options as PermissionRequest["options"],
      taskRunId,
      receivedAt: Date.now(),
    });

    this.d.store.setPendingPermissions(taskRunId, newPermissions);
    this.d.taskViewedApi.markActivity(session.taskId);
    this.d.notifyPermissionRequest(session.taskTitle, session.taskId);
  }

  private surfacePersistedPendingPermissions(
    taskRunId: string,
    entries: StoredLogEntry[],
  ): void {
    for (const request of derivePendingPermissionRequests(entries)) {
      this.handleCloudPermissionRequest(taskRunId, request);
    }
  }

  // --- Prompt Handling ---

  /**
   * Send a prompt to the agent.
   * Queues if a prompt is already pending.
   */
  async sendPrompt(
    taskId: string,
    prompt: string | ContentBlock[],
    options?: { steer?: boolean },
  ): Promise<{ stopReason: string }> {
    if (!this.d.getIsOnline()) {
      throw new Error(
        "No internet connection. Please check your connection and try again.",
      );
    }

    let session = this.d.store.getSessionByTaskId(taskId);
    if (!session) throw new Error("No active session for task");

    // The /add-dir dialog mutates the per-task additional-directories list and
    // we re-read it during respawn below. Sending while it's open would race
    // and respawn with the pre-decision set, so block here.
    if (this.d.addDirectoryDialog.open) {
      throw new Error(
        "Confirm the folder access dialog before sending your message.",
      );
    }

    // Steer: the user sent a message mid-turn and asked to fold it into the
    // running turn rather than queue it. Native (Claude) injects at the next
    // tool boundary; everything else interrupts the turn and resends below as a
    // fresh prompt. Compaction always falls through to the queue.
    if (options?.steer && session.isPromptPending && !session.isCompacting) {
      const supportsNativeSteer =
        !session.isCloud && session.adapter === "claude";
      if (supportsNativeSteer) {
        return this.sendSteerPrompt(session, prompt);
      }
      await this.cancelPrompt(taskId);
      const refreshed = this.d.store.getSessionByTaskId(taskId);
      if (refreshed) {
        session = refreshed;
      }
    }

    if (session.isCloud) {
      return this.sendCloudPrompt(session, prompt);
    }

    if (session.status !== "connected") {
      if (session.status === "error") {
        throw new Error(
          session.errorMessage ||
            "Session is in error state. Please retry or start a new session.",
        );
      }
      if (session.status === "connecting") {
        throw new Error(
          "Session is still connecting. Please wait and try again.",
        );
      }
      throw new Error(`Session is not ready (status: ${session.status})`);
    }

    if (session.isPromptPending || session.isCompacting) {
      const promptText = extractPromptText(prompt);
      this.d.store.enqueueMessage(taskId, promptText);
      this.d.log.info("Message queued", {
        taskId,
        queueLength: session.messageQueue.length + 1,
        reason: session.isCompacting ? "compacting" : "prompt_pending",
      });
      return { stopReason: "queued" };
    }

    let blocks = normalizePromptToBlocks(prompt);

    const shellExecutes = getUserShellExecutesSinceLastPrompt(session.events);
    if (shellExecutes.length > 0) {
      const contextBlocks = shellExecutesToContextBlocks(shellExecutes);
      blocks = [...contextBlocks, ...blocks];
    }

    const promptText = extractPromptText(prompt);
    this.d.track(ANALYTICS_EVENTS.PROMPT_SENT, {
      task_id: taskId,
      is_initial: session.events.length === 0,
      execution_type: "local",
      prompt_length_chars: promptText.length,
    });

    // Show the user's message in the chat immediately, before any respawn
    this.applyOptimisticPrompt(session.taskRunId, blocks, promptText);

    if (promptReferencesAbsoluteFolder(prompt)) {
      const repoPath = this.localRepoPaths.get(taskId);
      if (repoPath) {
        try {
          await this.reconnectInPlace(taskId, repoPath);
        } catch (err) {
          this.d.log.error("Respawn failed; aborting prompt send", {
            taskId,
            err,
          });
          this.d.store.clearOptimisticItems(session.taskRunId);
          this.d.store.updateSession(session.taskRunId, {
            isPromptPending: false,
            promptStartedAt: null,
          });
          this.d.toast.error("Couldn't grant the new folder access", {
            description:
              "The session needs to restart to pick up the added folder. Try sending again, or remove the folder reference.",
          });
          throw err instanceof Error
            ? err
            : new Error("Failed to apply additional directories");
        }
        const refreshed = this.d.store.getSessionByTaskId(taskId);
        if (refreshed) {
          session = refreshed;
        }
      }
    }

    return this.sendLocalPrompt(session, blocks, promptText, {
      optimisticApplied: true,
    });
  }

  /**
   * Send a steer message: folded into the turn already running rather than
   * queued. It renders when its `session/prompt` echo arrives and is injected
   * by the agent at the next tool boundary. The running turn keeps ownership of
   * the prompt lifecycle, so this never touches isPromptPending.
   */
  private async sendSteerPrompt(
    session: AgentSession,
    prompt: string | ContentBlock[],
  ): Promise<{ stopReason: string }> {
    const blocks = normalizePromptToBlocks(prompt);
    const promptText = extractPromptText(prompt);

    this.d.track(ANALYTICS_EVENTS.PROMPT_SENT, {
      task_id: session.taskId,
      is_initial: false,
      execution_type: "local",
      prompt_length_chars: promptText.length,
      is_steer: true,
    });

    return this.d.trpc.agent.prompt.mutate({
      sessionId: session.taskRunId,
      prompt: blocks,
      steer: true,
    });
  }

  /**
   * Send all queued messages as a single prompt.
   * Called internally when a turn completes and there are queued messages.
   * Queue is cleared atomically before sending - if sending fails, messages are lost
   * (this is acceptable since the user can re-type; avoiding complex retry logic).
   */
  private async sendQueuedMessages(
    taskId: string,
  ): Promise<{ stopReason: string }> {
    const combinedText = this.d.store.dequeueMessagesAsText(taskId);
    if (!combinedText) {
      return { stopReason: "skipped" };
    }

    const session = this.d.store.getSessionByTaskId(taskId);
    if (!session) {
      this.d.log.warn("No session found for queued messages, messages lost", {
        taskId,
        lostMessageLength: combinedText.length,
      });
      return { stopReason: "no_session" };
    }

    this.d.log.info("Sending queued messages as single prompt", {
      taskId,
      promptLength: combinedText.length,
    });

    let blocks = normalizePromptToBlocks(combinedText);

    const shellExecutes = getUserShellExecutesSinceLastPrompt(session.events);
    if (shellExecutes.length > 0) {
      const contextBlocks = shellExecutesToContextBlocks(shellExecutes);
      blocks = [...contextBlocks, ...blocks];
    }

    this.d.track(ANALYTICS_EVENTS.PROMPT_SENT, {
      task_id: taskId,
      is_initial: false,
      execution_type: "local",
      prompt_length_chars: combinedText.length,
    });

    try {
      return await this.sendLocalPrompt(session, blocks, combinedText);
    } catch (error) {
      // Log that queued messages were lost due to send failure
      this.d.log.error("Failed to send queued messages, messages lost", {
        taskId,
        lostMessageLength: combinedText.length,
        error,
      });
      throw error;
    }
  }

  private applyOptimisticPrompt(
    taskRunId: string,
    blocks: ContentBlock[],
    promptText: string,
  ): void {
    this.d.store.updateSession(taskRunId, {
      isPromptPending: true,
      promptStartedAt: Date.now(),
      pausedDurationMs: 0,
    });

    const skillButtonId = this.d.h.extractSkillButtonId(blocks);
    if (skillButtonId) {
      this.d.store.appendOptimisticItem(taskRunId, {
        type: "skill_button_action",
        buttonId: skillButtonId,
      });
    } else {
      this.d.store.appendOptimisticItem(taskRunId, {
        type: "user_message",
        content: promptText,
        timestamp: Date.now(),
      });
    }
  }

  private async sendLocalPrompt(
    session: AgentSession,
    blocks: ContentBlock[],
    promptText: string,
    options: { optimisticApplied?: boolean } = {},
  ): Promise<{ stopReason: string }> {
    if (!options.optimisticApplied) {
      this.applyOptimisticPrompt(session.taskRunId, blocks, promptText);
    }

    try {
      const result = await this.d.trpc.agent.prompt.mutate({
        sessionId: session.taskRunId,
        prompt: blocks,
      });
      this.d.store.updateSession(session.taskRunId, {
        isPromptPending: false,
        promptStartedAt: null,
      });
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorDetails = (error as { data?: { details?: string } }).data
        ?.details;

      this.d.store.clearOptimisticItems(session.taskRunId);

      if (isRateLimitError(errorMessage, errorDetails)) {
        this.d.log.warn("Rate limit exceeded, showing usage limit modal", {
          taskRunId: session.taskRunId,
        });
        this.d.store.updateSession(session.taskRunId, {
          isPromptPending: false,
          promptStartedAt: null,
        });
        this.d.usageLimit.show();
        return { stopReason: "rate_limited" };
      }

      if (isFatalSessionError(errorMessage, errorDetails)) {
        this.d.log.error("Fatal prompt error, attempting recovery", {
          taskRunId: session.taskRunId,
          errorMessage,
          errorDetails,
        });
        this.startAutoRecoverLocalSession(
          session.taskId,
          session.taskRunId,
          session.taskTitle,
          errorDetails || errorMessage,
          errorDetails ||
            "Session connection lost. Please retry or start a new session.",
        );
      } else {
        this.d.store.updateSession(session.taskRunId, {
          isPromptPending: false,
          isCompacting: false,
          promptStartedAt: null,
        });
      }

      throw error;
    }
  }

  /**
   * Steer a single queued message into the running turn now: drop it from the
   * queue and resend it as a steer. Native (Claude, local) injects at the next
   * tool boundary; cloud/Codex interrupt and resend. The rest of the queue is
   * left in place and drains when the turn ends. Rolls the message back onto
   * the queue if the send fails so it is not silently lost.
   */
  async steerQueuedMessage(taskId: string, messageId: string): Promise<void> {
    const session = this.d.store.getSessionByTaskId(taskId);
    if (!session) return;
    // Steer falls through to the queue during compaction, which would re-enqueue
    // the message as plain text and drop its rawPrompt. Leave it queued; it
    // drains normally once compaction ends.
    if (session.isCompacting) return;
    const message = session.messageQueue.find((m) => m.id === messageId);
    if (!message) return;

    this.d.store.removeQueuedMessage(taskId, messageId);
    try {
      await this.sendPrompt(taskId, message.rawPrompt ?? message.content, {
        steer: true,
      });
    } catch (error) {
      this.d.store.prependQueuedMessages(taskId, [message]);
      throw error;
    }
  }

  /**
   * Cancel the current prompt.
   */
  async cancelPrompt(taskId: string): Promise<boolean> {
    const session = this.d.store.getSessionByTaskId(taskId);
    if (!session) return false;

    this.d.store.updateSession(session.taskRunId, {
      isPromptPending: false,
      promptStartedAt: null,
    });

    if (session.isCloud) {
      return this.cancelCloudPrompt(session);
    }

    try {
      const result = await this.d.trpc.agent.cancelPrompt.mutate({
        sessionId: session.taskRunId,
      });

      const durationSeconds = Math.round(
        (Date.now() - session.startedAt) / 1000,
      );
      const promptCount = session.events.filter(
        (e) => "method" in e.message && e.message.method === "session/prompt",
      ).length;
      this.d.track(ANALYTICS_EVENTS.TASK_RUN_CANCELLED, {
        task_id: taskId,
        execution_type: "local",
        duration_seconds: durationSeconds,
        prompts_sent: promptCount,
      });

      return result;
    } catch (error) {
      this.d.log.error("Failed to cancel prompt", error);
      return false;
    }
  }

  // --- Cloud Commands ---

  private async sendCloudPrompt(
    session: AgentSession,
    prompt: string | ContentBlock[],
    options?: { skipQueueGuard?: boolean },
  ): Promise<{ stopReason: string }> {
    const transport = this.d.h.getCloudPromptTransport(prompt);
    if (!transport.messageText && transport.filePaths.length === 0) {
      return { stopReason: "empty" };
    }

    if (isTerminalStatus(session.cloudStatus)) {
      // If the agent never booted (no `run_started`), resuming spins another
      // sandbox that hits the same provisioning failure — surface the error
      // instead of looping.
      if (session.cloudStatus === "failed" && session.status !== "connected") {
        throw new Error(
          session.cloudErrorMessage ??
            "Cloud run couldn't start. Check that GitHub is connected for this project, then try again.",
        );
      }
      return this.resumeCloudRun(session, prompt);
    }

    if (session.cloudStatus !== "in_progress") {
      this.d.store.enqueueMessage(session.taskId, transport.promptText);
      this.d.log.info("Cloud message queued (sandbox not ready)", {
        taskId: session.taskId,
        cloudStatus: session.cloudStatus,
      });
      return { stopReason: "queued" };
    }

    // Agent-readiness guard: until we've received `_posthog/run_started`
    // (which flips `session.status` to `"connected"`), the agent may
    // still be booting / restoring after a sandbox restart, or mid-
    // initial-prompt — sending now would race with its
    // `clientConnection.prompt(initialPrompt)` on the same ACP session.
    // Funnel through the queue; the run_started or turn_complete
    // handlers will drain it once the agent is provably ready.
    if (
      !options?.skipQueueGuard &&
      session.isCloud &&
      session.status !== "connected"
    ) {
      this.d.store.enqueueMessage(session.taskId, transport.promptText, prompt);
      this.d.log.info("Cloud message queued (agent not ready)", {
        taskId: session.taskId,
        sessionStatus: session.status,
        queueLength: session.messageQueue.length + 1,
      });
      // The watcher may have exhausted its reconnect budget and been left in a
      // failed state — without an SSE stream, no `turn_complete` will arrive
      // to drain the queue. Kick a retry so the stream comes back online; the
      // queued message dispatches naturally once `run_started`/`turn_complete`
      // is observed.
      if (session.status === "disconnected" || session.status === "error") {
        this.retryCloudTaskWatch(session.taskId).catch((err) => {
          this.d.log.warn(
            "Auto-retry of cloud task watch from queue gate failed",
            {
              taskId: session.taskId,
              error: String(err),
            },
          );
        });
      }
      return { stopReason: "queued" };
    }

    if (!options?.skipQueueGuard && session.isPromptPending) {
      this.d.store.enqueueMessage(session.taskId, transport.promptText, prompt);
      this.d.log.info("Cloud message queued", {
        taskId: session.taskId,
        queueLength: session.messageQueue.length + 1,
      });
      return { stopReason: "queued" };
    }

    const authStatus = await this.getAuthCredentialsStatus();
    if (authStatus.kind === "restoring") {
      return this.queueRestoringCloudPrompt(
        session,
        prompt,
        "Cloud message queued (auth restoring)",
      );
    }

    const cloudCommandAuth = await this.getCloudCommandAuth();
    if (authStatus.kind !== "ready" || !cloudCommandAuth) {
      throw new Error("Authentication required for cloud commands");
    }
    const { auth } = authStatus;

    this.watchCloudTask(
      session.taskId,
      session.taskRunId,
      cloudCommandAuth.apiHost,
      cloudCommandAuth.teamId,
      undefined,
      session.logUrl,
      undefined,
      session.adapter ?? "claude",
    );

    const artifactIds = await this.d.h.uploadRunAttachments(
      auth.client,
      session.taskId,
      session.taskRunId,
      transport.filePaths,
    );
    const params: Record<string, unknown> = {};
    if (transport.messageText) {
      params.content = transport.messageText;
    }
    if (artifactIds.length > 0) {
      params.artifact_ids = artifactIds;
    }

    const currentSessionBeforeSend =
      this.getSessionByRunId(session.taskRunId) ?? session;
    const idleEvidenceBeforeSend = this.cloudRunIdleTracker.capture(
      currentSessionBeforeSend,
    );
    this.d.store.updateSession(session.taskRunId, {
      isPromptPending: true,
      promptStartedAt: Date.now(),
      pausedDurationMs: 0,
      agentIdleForRunId: undefined,
    });
    this.cloudRunIdleTracker.markBusy(currentSessionBeforeSend);
    this.d.store.appendOptimisticItem(session.taskRunId, {
      type: "user_message",
      content: transport.promptText,
      timestamp: Date.now(),
      pinToTop: false,
    });

    this.d.track(ANALYTICS_EVENTS.PROMPT_SENT, {
      task_id: session.taskId,
      is_initial: session.events.length === 0,
      execution_type: "cloud",
      prompt_length_chars: transport.promptText.length,
    });

    try {
      const result = await this.d.trpc.cloudTask.sendCommand.mutate({
        taskId: session.taskId,
        runId: session.taskRunId,
        apiHost: cloudCommandAuth.apiHost,
        teamId: cloudCommandAuth.teamId,
        method: "user_message",
        params,
      });

      if (!result.success) {
        throw new Error(result.error ?? "Failed to send cloud command");
      }

      const commandResult = result.result as
        | { queued?: boolean; stopReason?: string }
        | undefined;
      const stopReason = commandResult?.queued
        ? "queued"
        : (commandResult?.stopReason ?? "end_turn");

      return { stopReason };
    } catch (error) {
      this.d.store.updateSession(session.taskRunId, {
        isPromptPending: false,
        promptStartedAt: null,
      });
      this.d.store.clearTailOptimisticItems(session.taskRunId);
      const currentSessionAfterFailure = this.getSessionByRunId(
        session.taskRunId,
      );
      if (currentSessionAfterFailure) {
        const restoreResult = this.cloudRunIdleTracker.restoreAfterFailedSend(
          idleEvidenceBeforeSend,
          currentSessionAfterFailure,
        );
        if (restoreResult) {
          this.d.log.warn("Restored idle evidence after failed cloud send", {
            taskId: session.taskId,
            taskRunId: session.taskRunId,
          });
          if (
            currentSessionAfterFailure.agentIdleForRunId !==
            restoreResult.agentIdleForRunId
          ) {
            this.d.store.updateSession(session.taskRunId, {
              agentIdleForRunId: restoreResult.agentIdleForRunId,
            });
          }
        }
      }
      throw error;
    }
  }

  /**
   * Dispatches all currently queued cloud messages as a single combined
   * prompt. Drains the queue up-front and rolls it back on failure so the
   * next dispatch trigger (turn_complete, cloudStatus flip) can retry. A
   * per-taskId re-entrance guard prevents concurrent triggers from
   * double-dispatching.
   *
   * Pre-flight conditions match what `sendCloudPrompt` would otherwise
   * silently re-queue on (sandbox not in_progress, prompt already pending).
   * Skipping early lets the next trigger retry instead of re-queueing the
   * already-dequeued prompt back into the same queue.
   */
  private async sendQueuedCloudMessages(taskId: string): Promise<void> {
    if (this.dispatchingCloudQueues.has(taskId)) return;

    this.dispatchingCloudQueues.add(taskId);
    try {
      const session = this.d.store.getSessionByTaskId(taskId);
      if (!session?.isCloud || session.messageQueue.length === 0) return;
      // Terminal cloud runs route through `resumeCloudRun`, which spins a
      // new run and consumes the prompt itself — so dispatch is fine.
      // Otherwise gate on the agent-ready handshake (`run_started` flips
      // status to "connected") to avoid racing with `sendInitialTaskMessage`.
      const isTerminal = isTerminalStatus(session.cloudStatus);
      const canSendNow =
        isTerminal ||
        (session.cloudStatus === "in_progress" &&
          session.status === "connected");
      if (!canSendNow || session.isPromptPending) return;

      // Draining while auth is still restoring would route through the restoring
      // gate in sendCloudPrompt, re-enqueueing a single merged prompt and losing
      // the original message boundaries. The auth-restored flush re-runs this
      // once credentials are ready.
      const authStatus = await this.getAuthCredentialsStatus();
      if (authStatus.kind === "restoring") return;

      const drained = this.d.store.dequeueMessages(taskId);
      const combined = this.d.h.combineQueuedCloudPrompts(drained);
      if (!combined) return;

      this.d.log.info("Sending queued cloud messages", {
        taskId,
        drainedCount: drained.length,
      });

      try {
        await this.sendCloudPrompt(session, combined, {
          skipQueueGuard: true,
        });
      } catch (err) {
        this.d.log.warn("Cloud queue dispatch failed; re-enqueueing", {
          taskId,
          error: String(err),
        });
        this.d.store.prependQueuedMessages(taskId, drained);
      }
    } finally {
      this.dispatchingCloudQueues.delete(taskId);
    }
  }

  private async resumeCloudRun(
    session: AgentSession,
    prompt: string | ContentBlock[],
  ): Promise<{ stopReason: string }> {
    const authStatus = await this.getAuthCredentialsStatus();
    if (authStatus.kind === "restoring") {
      return this.queueRestoringCloudPrompt(
        session,
        prompt,
        "Cloud resume queued (auth restoring)",
      );
    }
    if (authStatus.kind !== "ready") {
      throw new Error("Authentication required for cloud commands");
    }
    const authCredentials = authStatus.auth;

    const auth = await this.getCloudCommandAuth();
    if (!auth) {
      throw new Error("Authentication required for cloud commands");
    }

    const transport = this.d.h.getCloudPromptTransport(prompt);
    if (!transport.messageText && transport.filePaths.length === 0) {
      return { stopReason: "empty" };
    }
    const artifactIds = await this.d.h.uploadTaskStagedAttachments(
      authCredentials.client,
      session.taskId,
      transport.filePaths,
    );

    const previousRun = await authCredentials.client.getTaskRun(
      session.taskId,
      session.taskRunId,
    );
    const previousState = previousRun.state as Record<string, unknown>;
    const previousOutput = (previousRun.output ?? {}) as Record<
      string,
      unknown
    >;
    // Prefer the actual working branch the agent last pushed to (synced by
    // agent-server after each turn), then the run-level branch field, then
    // the original base branch from state. This preserves unmerged work when
    // the snapshot has expired and the sandbox is rebuilt from scratch.
    const previousBaseBranch =
      (typeof previousOutput.head_branch === "string"
        ? previousOutput.head_branch
        : null) ??
      previousRun.branch ??
      (typeof previousState.pr_base_branch === "string"
        ? previousState.pr_base_branch
        : null) ??
      session.cloudBranch;
    const prAuthorshipMode = getCloudPrAuthorshipMode(previousState);

    this.d.log.info("Creating resume run for terminal cloud task", {
      taskId: session.taskId,
      previousRunId: session.taskRunId,
      previousStatus: session.cloudStatus,
    });

    const runtimeOptions = getCloudRuntimeOptions(session, previousRun);

    // Create a new run WITH resume context — backend validates the previous run,
    // derives snapshot_external_id server-side, and passes everything as extra_state.
    // The agent will load conversation history and restore the sandbox snapshot.
    const updatedTask = await authCredentials.client.runTaskInCloud(
      session.taskId,
      previousBaseBranch,
      {
        adapter: runtimeOptions.adapter,
        model: runtimeOptions.model,
        reasoningLevel: runtimeOptions.reasoningLevel,
        resumeFromRunId: session.taskRunId,
        pendingUserMessage: transport.messageText,
        pendingUserArtifactIds:
          artifactIds.length > 0 ? artifactIds : undefined,
        prAuthorshipMode,
        runSource: getCloudRunSource(previousState),
        signalReportId:
          typeof previousState.signal_report_id === "string"
            ? previousState.signal_report_id
            : undefined,
      },
    );
    const newRun = updatedTask.latest_run;
    if (!newRun?.id) {
      throw new Error("Failed to create resume run");
    }

    // Replace session with one for the new run, preserving conversation history.
    // setSession handles old session cleanup via taskIdIndex.
    const newSession = createBaseSession(
      newRun.id,
      session.taskId,
      session.taskTitle,
    );
    newSession.status = "disconnected";
    newSession.isCloud = true;
    // Carry over existing events and add optimistic user bubble for the follow-up.
    // Reset processedLineCount to 0 because the new run's log stream starts fresh.
    newSession.events = [
      ...session.events,
      createUserPromptEvent(
        transport.filePaths.length > 0
          ? this.d.h.cloudPromptToBlocks(prompt)
          : [{ type: "text", text: transport.promptText }],
        Date.now(),
      ),
    ];
    newSession.processedLineCount = 0;
    // Skip the first session/prompt from polled logs — we already have the
    // optimistic user event, so showing the polled one would duplicate it.
    newSession.skipPolledPromptCount = 1;
    this.d.store.setSession(newSession);

    // No enqueueMessage / isPromptPending needed — the follow-up is passed
    // in run state (pending_user_message), NOT via user_message command.

    // Start the watcher immediately so we don't miss status updates.
    const initialMode =
      typeof newRun.state?.initial_permission_mode === "string"
        ? newRun.state.initial_permission_mode
        : undefined;
    const priorModel = getConfigOptionByCategory(
      session.configOptions,
      "model",
    )?.currentValue;
    const initialModel =
      newRun.model ?? (typeof priorModel === "string" ? priorModel : undefined);
    this.watchCloudTask(
      session.taskId,
      newRun.id,
      auth.apiHost,
      auth.teamId,
      undefined,
      newRun.log_url,
      initialMode,
      newRun.runtime_adapter ?? session.adapter ?? "claude",
      initialModel,
    );

    // Invalidate task queries so the UI picks up the new run metadata
    this.d.queryClient.invalidateQueries({ queryKey: ["tasks"] });

    this.d.track(ANALYTICS_EVENTS.PROMPT_SENT, {
      task_id: session.taskId,
      is_initial: false,
      execution_type: "cloud",
      prompt_length_chars: transport.promptText.length,
    });

    return { stopReason: "queued" };
  }

  private async cancelCloudPrompt(session: AgentSession): Promise<boolean> {
    if (isTerminalStatus(session.cloudStatus)) {
      this.d.log.info("Skipping cancel for terminal cloud run", {
        taskId: session.taskId,
        status: session.cloudStatus,
      });
      return false;
    }

    const auth = await this.getCloudCommandAuth();
    if (!auth) {
      this.d.log.error("No auth for cloud cancel");
      return false;
    }

    try {
      const result = await this.d.trpc.cloudTask.sendCommand.mutate({
        taskId: session.taskId,
        runId: session.taskRunId,
        apiHost: auth.apiHost,
        teamId: auth.teamId,
        method: "cancel",
      });

      const durationSeconds = Math.round(
        (Date.now() - session.startedAt) / 1000,
      );
      const promptCount = session.events.filter(
        (e) => "method" in e.message && e.message.method === "session/prompt",
      ).length;
      this.d.track(ANALYTICS_EVENTS.TASK_RUN_CANCELLED, {
        task_id: session.taskId,
        execution_type: "cloud",
        duration_seconds: durationSeconds,
        prompts_sent: promptCount,
      });

      if (!result.success) {
        this.d.log.warn("Cloud cancel command failed", { error: result.error });
        return false;
      }

      return true;
    } catch (error) {
      this.d.log.error("Failed to cancel cloud prompt", error);
      return false;
    }
  }

  private async getCloudCommandAuth(): Promise<{
    apiHost: string;
    teamId: number;
  } | null> {
    const authState = await this.d.fetchAuthState();
    if (!authState.cloudRegion || !authState.currentProjectId) return null;
    return {
      apiHost: getCloudUrlFromRegion(authState.cloudRegion),
      teamId: authState.currentProjectId,
    };
  }

  /**
   * Send a command to the cloud agent server via the backend proxy.
   * Handles auth lookup and throws if credentials are unavailable.
   */
  private async sendCloudCommand(
    session: AgentSession,
    method: "permission_response" | "set_config_option",
    params: Record<string, unknown>,
  ): Promise<void> {
    const auth = await this.getCloudCommandAuth();
    if (!auth) {
      throw new Error("No cloud auth credentials available");
    }
    await this.d.trpc.cloudTask.sendCommand.mutate({
      taskId: session.taskId,
      runId: session.taskRunId,
      apiHost: auth.apiHost,
      teamId: auth.teamId,
      method,
      params,
    });
  }

  // --- Permissions ---

  private resolvePermission(session: AgentSession, toolCallId: string): void {
    const permission = session.pendingPermissions.get(toolCallId);
    const newPermissions = new Map(session.pendingPermissions);
    newPermissions.delete(toolCallId);
    this.d.store.setPendingPermissions(session.taskRunId, newPermissions);

    if (permission?.receivedAt) {
      this.d.store.updateSession(session.taskRunId, {
        pausedDurationMs:
          (session.pausedDurationMs ?? 0) +
          (Date.now() - permission.receivedAt),
      });
    }
  }

  /**
   * Respond to a permission request.
   */
  async respondToPermission(
    taskId: string,
    toolCallId: string,
    optionId: string,
    customInput?: string,
    answers?: Record<string, string>,
  ): Promise<void> {
    const session = this.d.store.getSessionByTaskId(taskId);
    if (!session) {
      this.d.log.error("No session found for permission response", { taskId });
      return;
    }

    const permission = session.pendingPermissions.get(toolCallId);
    this.d.track(ANALYTICS_EVENTS.PERMISSION_RESPONDED, {
      task_id: taskId,
      ...this.d.buildPermissionToolMetadata(permission, optionId, customInput),
    });

    const cloudRequestId = this.cloudPermissionRequestIds.get(toolCallId);
    this.resolvePermission(session, toolCallId);

    try {
      if (session.isCloud && cloudRequestId) {
        this.cloudPermissionRequestIds.delete(toolCallId);
        await this.sendCloudCommand(session, "permission_response", {
          requestId: cloudRequestId,
          optionId,
          customInput,
          answers,
        });
      } else {
        await this.d.trpc.agent.respondToPermission.mutate({
          taskRunId: session.taskRunId,
          toolCallId,
          optionId,
          customInput,
          answers,
        });
      }

      this.d.log.info("Permission response sent", {
        taskId,
        toolCallId,
        optionId,
        isCloud: !!cloudRequestId,
        hasCustomInput: !!customInput,
      });
    } catch (error) {
      this.d.log.error("Failed to respond to permission", {
        taskId,
        toolCallId,
        optionId,
        error,
      });
    }
  }

  /**
   * Cancel a permission request.
   */
  async cancelPermission(taskId: string, toolCallId: string): Promise<void> {
    const session = this.d.store.getSessionByTaskId(taskId);
    if (!session) {
      this.d.log.error("No session found for permission cancellation", {
        taskId,
      });
      return;
    }

    const permission = session.pendingPermissions.get(toolCallId);
    this.d.track(ANALYTICS_EVENTS.PERMISSION_CANCELLED, {
      task_id: taskId,
      ...this.d.buildPermissionToolMetadata(permission),
    });

    const cloudRequestId = this.cloudPermissionRequestIds.get(toolCallId);
    this.resolvePermission(session, toolCallId);

    try {
      if (session.isCloud && cloudRequestId) {
        this.cloudPermissionRequestIds.delete(toolCallId);
        await this.sendCloudCommand(session, "permission_response", {
          requestId: cloudRequestId,
          optionId: "reject_with_feedback",
          customInput: "User cancelled the permission request.",
        });
      } else {
        await this.d.trpc.agent.cancelPermission.mutate({
          taskRunId: session.taskRunId,
          toolCallId,
        });
      }

      this.d.log.info("Permission cancelled", {
        taskId,
        toolCallId,
        isCloud: !!cloudRequestId,
      });
    } catch (error) {
      this.d.log.error("Failed to cancel permission", {
        taskId,
        toolCallId,
        error,
      });
    }
  }

  // --- Config Option Changes (Optimistic Updates) ---

  /**
   * Set a session configuration option with optimistic update and rollback.
   * This is the unified method for model, mode, thought level, etc.
   */
  async setSessionConfigOption(
    taskId: string,
    configId: string,
    value: string,
  ): Promise<void> {
    const session = this.d.store.getSessionByTaskId(taskId);
    if (!session) return;

    // Find the config option and save previous value for rollback
    const configOptions = session.configOptions ?? [];
    const optionIndex = configOptions.findIndex((opt) => opt.id === configId);
    if (optionIndex === -1) {
      this.d.log.warn("Config option not found", { taskId, configId });
      return;
    }

    const previousValue = configOptions[optionIndex].currentValue;

    // Skip if value is already set — avoids expensive IPC round-trip (e.g. setModel ~2s)
    if (previousValue === value) {
      return;
    }

    // Optimistic update
    const updatedOptions = configOptions.map((opt) =>
      opt.id === configId
        ? ({ ...opt, currentValue: value } as SessionConfigOption)
        : opt,
    );
    this.d.store.updateSession(session.taskRunId, {
      configOptions: updatedOptions,
    });
    this.d.updatePersistedConfigOptionValue(session.taskRunId, configId, value);

    if (
      !session.isCloud &&
      (session.idleKilled ||
        session.status === "disconnected" ||
        session.status === "connecting")
    ) {
      return;
    }

    try {
      if (session.isCloud) {
        await this.sendCloudCommand(session, "set_config_option", {
          configId,
          value,
        });
      } else {
        await this.d.trpc.agent.setConfigOption.mutate({
          sessionId: session.taskRunId,
          configId,
          value,
        });
      }
    } catch (error) {
      // Rollback on error
      const rolledBackOptions = configOptions.map((opt) =>
        opt.id === configId
          ? ({ ...opt, currentValue: previousValue } as SessionConfigOption)
          : opt,
      );
      this.d.store.updateSession(session.taskRunId, {
        configOptions: rolledBackOptions,
      });
      this.d.updatePersistedConfigOptionValue(
        session.taskRunId,
        configId,
        String(previousValue),
      );
      this.d.log.error("Failed to set session config option", {
        taskId,
        configId,
        value,
        error,
      });
      this.d.toast.error("Failed to change setting. Please try again.");
    }
  }

  /**
   * Set a session configuration option by category (e.g., "mode", "model").
   * This is a convenience method that looks up the config ID by category.
   */
  async setSessionConfigOptionByCategory(
    taskId: string,
    category: string,
    value: string,
  ): Promise<void> {
    const session = this.d.store.getSessionByTaskId(taskId);
    if (!session) return;

    const configOption = getConfigOptionByCategory(
      session.configOptions,
      category,
    );
    if (!configOption) {
      this.d.log.warn("Config option not found for category", {
        taskId,
        category,
      });
      return;
    }

    if (configOption.currentValue !== value) {
      this.d.track(ANALYTICS_EVENTS.SESSION_CONFIG_CHANGED, {
        task_id: taskId,
        category,
        from_value: String(configOption.currentValue),
        to_value: value,
      });
    }

    await this.setSessionConfigOption(taskId, configOption.id, value);
  }

  /**
   * Start a user shell execute event (shows command as running).
   * Call completeUserShellExecute with the same id when the command finishes.
   */
  async startUserShellExecute(
    taskId: string,
    id: string,
    command: string,
    cwd: string,
  ): Promise<void> {
    const session = this.d.store.getSessionByTaskId(taskId);
    if (!session) return;

    const event = createUserShellExecuteEvent(command, cwd, undefined, id);
    this.d.store.appendEvents(session.taskRunId, [event]);
  }

  /**
   * Complete a user shell execute event with results.
   * Must be called after startUserShellExecute with the same id.
   */
  async completeUserShellExecute(
    taskId: string,
    id: string,
    command: string,
    cwd: string,
    result: { stdout: string; stderr: string; exitCode: number },
  ): Promise<void> {
    const session = this.d.store.getSessionByTaskId(taskId);
    if (!session) return;

    const storedEntry: StoredLogEntry = {
      type: "notification",
      timestamp: new Date().toISOString(),
      notification: {
        method: "_array/user_shell_execute",
        params: { id, command, cwd, result },
      },
    };

    const event = createUserShellExecuteEvent(command, cwd, result, id);

    await this.appendAndPersist(taskId, session, event, storedEntry);
  }

  /**
   * Retry connecting to the existing session (resume attempt using
   * the sessionId from logs). Does NOT tear down — avoids the connect
   * effect loop.
   *
   * If the session failed before any conversation started (has an
   * initialPrompt saved from the original creation attempt), creates
   * a fresh session and re-sends the prompt instead of reconnecting
   * to an empty session.
   */
  async clearSessionError(taskId: string, repoPath: string): Promise<void> {
    this.localRepoPaths.set(taskId, repoPath);
    const session = this.d.store.getSessionByTaskId(taskId);
    if (session?.initialPrompt?.length) {
      const { taskTitle, initialPrompt } = session;
      await this.teardownSession(session.taskRunId);
      const authStatus = await this.getAuthCredentialsStatus();
      if (authStatus.kind === "restoring") {
        throw new Error("Authentication is still restoring. Please wait.");
      }
      if (authStatus.kind !== "ready") {
        throw new Error(
          "Unable to reach server. Please check your connection.",
        );
      }
      await this.createNewLocalSession(
        taskId,
        taskTitle,
        repoPath,
        authStatus.auth,
        initialPrompt,
      );
      return;
    }
    await this.reconnectInPlace(taskId, repoPath);
  }

  /**
   * Start a fresh session for a task, abandoning the old conversation.
   * Clears the backend sessionId so the next reconnect creates a new
   * session instead of attempting to resume the stale one.
   */
  async resetSession(taskId: string, repoPath: string): Promise<void> {
    this.localRepoPaths.set(taskId, repoPath);
    await this.reconnectInPlace(taskId, repoPath, null);
  }

  /**
   * Cancel the current backend agent and reconnect under the same taskRunId.
   * Does NOT remove the session from the store (avoids connect effect loop).
   * Overwrites the store session in place via reconnectToLocalSession.
   *
   * @param overrideSessionId - Controls which sessionId is used for reconnect:
   *   - `undefined` (default): use the sessionId from logs (resume attempt)
   *   - `null`: strip the sessionId so the backend creates a fresh session
   *   - `string`: use that specific sessionId
   */
  private async reconnectInPlace(
    taskId: string,
    repoPath: string,
    overrideSessionId?: string | null,
  ): Promise<boolean> {
    this.localRepoPaths.set(taskId, repoPath);
    const session = this.d.store.getSessionByTaskId(taskId);
    if (!session) return false;

    const { taskRunId, taskTitle, logUrl } = session;

    // Cancel lingering backend agent (ignore errors — it may not exist
    // after a failed reconnect)
    try {
      await this.d.trpc.agent.cancel.mutate({ sessionId: taskRunId });
    } catch {
      // expected when backend has no session
    }
    this.unsubscribeFromChannel(taskRunId);

    const authStatus = await this.getAuthCredentialsStatus();
    if (authStatus.kind === "restoring") {
      throw new Error("Authentication is still restoring. Please wait.");
    }
    if (authStatus.kind !== "ready") {
      throw new Error("Unable to reach server. Please check your connection.");
    }
    const auth = authStatus.auth;

    const prefetchedLogs = await this.fetchSessionLogs(logUrl, taskRunId);

    // Determine sessionId: undefined = use from logs, null = strip (fresh), string = use as-is
    const sessionId =
      overrideSessionId === null
        ? undefined
        : (overrideSessionId ?? prefetchedLogs.sessionId);

    return this.reconnectToLocalSession(
      taskId,
      taskRunId,
      taskTitle,
      logUrl,
      repoPath,
      auth,
      { ...prefetchedLogs, sessionId },
    );
  }

  /**
   * Fetch model/effort options from the main-process preview-config endpoint
   * and merge them into the cloud session's configOptions. Cached per
   * (apiHost, adapter) so repeated visits don't refetch.
   *
   * Runs fire-and-forget: the session stays usable with just the `mode` option
   * if the fetch fails or is still in flight.
   */
  private async fetchAndApplyCloudPreviewOptions(
    taskRunId: string,
    apiHost: string,
    adapter: Adapter,
    initialModel?: string,
  ): Promise<void> {
    const cacheKey = `${apiHost}::${adapter}`;
    let entry = this.previewConfigOptionsCache.get(cacheKey);
    if (!entry || Date.now() - entry.fetchedAt > 300_000) {
      if (entry) this.previewConfigOptionsCache.delete(cacheKey);
      const promise = this.d.trpc.agent.getPreviewConfigOptions
        .query({ apiHost, adapter })
        .catch((err: unknown) => {
          this.d.log.warn(
            "Failed to fetch preview config options for cloud session",
            {
              apiHost,
              adapter,
              error: err,
            },
          );
          // Only evict if this entry is still the cached one; a concurrent
          // refresh may have replaced it and we must not drop the fresh entry.
          if (this.previewConfigOptionsCache.get(cacheKey) === entry) {
            this.previewConfigOptionsCache.delete(cacheKey);
          }
          return [] as SessionConfigOption[];
        });
      entry = { promise, fetchedAt: Date.now() };
      this.previewConfigOptionsCache.set(cacheKey, entry);
    }

    const previewOptions = await entry.promise;
    const extras = previewOptions
      .filter(
        (opt) => opt.category === "model" || opt.category === "thought_level",
      )
      .map((opt) => {
        if (
          opt.category === "model" &&
          opt.type === "select" &&
          typeof initialModel === "string"
        ) {
          const flat = flattenSelectOptions(opt.options);
          if (flat.some((o) => o.value === initialModel)) {
            return { ...opt, currentValue: initialModel };
          }
        }
        return opt;
      });

    if (extras.length === 0) return;

    const session = this.d.store.getSessions()[taskRunId];
    if (!session) return;

    const existingOptions = session.configOptions ?? [];
    const existingIds = new Set(existingOptions.map((o) => o.id));
    const newExtras = extras.filter((o) => !existingIds.has(o.id));
    if (newExtras.length === 0) return;
    const merged = [...existingOptions, ...newExtras];

    this.d.store.updateSession(taskRunId, { configOptions: merged });
  }

  /**
   * Start watching a cloud task via main-process CloudTaskService.
   *
   * The watcher stays alive across navigation. A fresh watcher is created only
   * on first visit or when the runId changes (new run started). Terminal
   * status triggers full teardown from within handleCloudTaskUpdate via
   * stopCloudTaskWatch().
   */
  watchCloudTask(
    taskId: string,
    runId: string,
    apiHost: string,
    teamId: number,
    onStatusChange?: () => void,
    logUrl?: string,
    initialMode?: string,
    adapter: Adapter = "claude",
    initialModel?: string,
    taskDescription?: string,
  ): () => void {
    const taskRunId = runId;
    const existingWatcher = this.cloudTaskWatchers.get(taskId);

    // Resuming same run — reuse the existing watcher.
    if (
      existingWatcher &&
      existingWatcher.runId === runId &&
      existingWatcher.apiHost === apiHost &&
      existingWatcher.teamId === teamId
    ) {
      if (onStatusChange) {
        existingWatcher.onStatusChange = onStatusChange;
      }
      // Ensure configOptions is populated on revisit
      const existing = this.d.store.getSessionByTaskId(taskId);
      if (existing) {
        const existingMode = getConfigOptionByCategory(
          existing.configOptions,
          "mode",
        )?.currentValue;
        const currentMode =
          typeof existingMode === "string" ? existingMode : initialMode;
        const shouldRefreshConfigOptions =
          !existing.configOptions?.length || existing.adapter !== adapter;
        if (shouldRefreshConfigOptions) {
          this.d.store.updateSession(existing.taskRunId, {
            adapter,
            configOptions: buildCloudDefaultConfigOptions(currentMode, adapter),
          });
        }
        void this.fetchAndApplyCloudPreviewOptions(
          existing.taskRunId,
          apiHost,
          adapter,
          initialModel,
        );
      }
      return () => {};
    }

    // An already-finished run we've already hydrated has no live stream to
    // attach to: the snapshot in the store is the complete, final conversation.
    // Re-watching it refetches the same logs, immediately stops again on the
    // terminal snapshot, and that snapshot rewrites session.configOptions,
    // which re-fires the reconcile effect and spins a start/stop loop. Skip it.
    // Gated on no live watcher: a stale watcher for a different run still needs
    // the stop-and-restart below.
    if (!existingWatcher) {
      const hydrated = this.d.store.getSessionByTaskId(taskId);
      if (
        hydrated?.taskRunId === taskRunId &&
        isTerminalStatus(hydrated.cloudStatus) &&
        hydrated.processedLineCount !== undefined
      ) {
        return () => {};
      }
    }

    // Different run — full cleanup of old watcher first
    if (existingWatcher) {
      this.stopCloudTaskWatch(taskId);
    }

    const startToken = ++this.nextCloudTaskWatchToken;

    // Create session in the store
    const existing = this.d.store.getSessionByTaskId(taskId);
    // A same-run session with history but no processedLineCount came from a
    // non-cloud hydration path. Reset it so the cloud snapshot becomes the
    // single source of truth instead of being appended on top.
    const shouldResetExistingSession =
      existing?.taskRunId === taskRunId &&
      existing.events.length > 0 &&
      existing.processedLineCount === undefined;
    const shouldHydrateSession =
      !existing ||
      existing.taskRunId !== taskRunId ||
      shouldResetExistingSession ||
      existing.events.length === 0;

    if (
      !existing ||
      existing.taskRunId !== taskRunId ||
      shouldResetExistingSession
    ) {
      const taskTitle = existing?.taskTitle ?? "Cloud Task";
      const session = createBaseSession(taskRunId, taskId, taskTitle);
      session.status = "disconnected";
      session.isCloud = true;
      session.adapter = adapter;
      session.configOptions = buildCloudDefaultConfigOptions(
        initialMode,
        adapter,
      );
      this.d.store.setSession(session);
      // Optimistic seeding for the initial task description is deferred
      // until `hydrateCloudTaskSessionFromLogs` confirms there's no prior
      // conversation. Otherwise reopening a task with history would flash
      // the description at top until hydration replaced it.
    } else {
      // Ensure cloud flag and configOptions are set on existing sessions
      const updates: Partial<AgentSession> = {};
      if (!existing.isCloud) updates.isCloud = true;
      if (existing.adapter !== adapter) updates.adapter = adapter;
      if (!existing.configOptions?.length || existing.adapter !== adapter) {
        const existingMode = getConfigOptionByCategory(
          existing.configOptions,
          "mode",
        )?.currentValue;
        const currentMode =
          typeof existingMode === "string" ? existingMode : initialMode;
        updates.configOptions = buildCloudDefaultConfigOptions(
          currentMode,
          adapter,
        );
      }
      if (Object.keys(updates).length > 0) {
        this.d.store.updateSession(existing.taskRunId, updates);
      }
    }

    void this.fetchAndApplyCloudPreviewOptions(
      taskRunId,
      apiHost,
      adapter,
      initialModel,
    );

    if (shouldHydrateSession) {
      this.hydrateCloudTaskSessionFromLogs(
        taskId,
        taskRunId,
        logUrl,
        taskDescription,
      );
    }

    // Subscribe before starting the main-process watcher so the first replayed
    // SSE/log burst cannot race ahead of the renderer subscription.
    const subscription = this.d.trpc.cloudTask.onUpdate.subscribe(
      { taskId, runId },
      {
        onData: (update: CloudTaskUpdatePayload) => {
          this.handleCloudTaskUpdate(taskRunId, update);
          const watcher = this.cloudTaskWatchers.get(taskId);
          if (
            (update.kind === "status" ||
              update.kind === "snapshot" ||
              update.kind === "error") &&
            watcher?.onStatusChange
          ) {
            watcher.onStatusChange();
          }
        },
        onError: (err: unknown) =>
          this.d.log.error("Cloud task subscription error", { taskId, err }),
      },
    );

    this.cloudTaskWatchers.set(taskId, {
      runId,
      apiHost,
      teamId,
      startToken,
      subscription,
      onStatusChange,
    });

    // Start main-process watcher after the subscription is attached.
    void (async () => {
      try {
        if (!this.isCurrentCloudTaskWatcher(taskId, runId, startToken)) {
          return;
        }

        await this.d.trpc.cloudTask.watch.mutate({
          taskId,
          runId,
          apiHost,
          teamId,
        });

        // If the local watcher was torn down while the watch request was in
        // flight, send a compensating unwatch after the start request lands.
        if (!this.isCurrentCloudTaskWatcher(taskId, runId, startToken)) {
          await this.d.trpc.cloudTask.unwatch.mutate({ taskId, runId });
        }
      } catch (err: unknown) {
        if (!this.isCurrentCloudTaskWatcher(taskId, runId, startToken)) {
          return;
        }
        this.d.log.warn("Failed to start cloud task watcher", { taskId, err });
      }
    })();

    return () => {};
  }

  /**
   * Stash the initial cloud prompt (user message plus any channel CONTEXT.md
   * block) so the optimistic placeholder can render it — and its CONTEXT.md
   * chip — immediately, instead of waiting for the sandbox to boot and echo it
   * back. Best-effort: lost on reload, where the merge layer dedupes the echo
   * against the bare placeholder instead.
   */
  rememberInitialCloudPrompt(taskId: string, content: string): void {
    const trimmed = content.trim();
    if (trimmed) {
      this.initialCloudOptimisticPrompt.set(taskId, content);
    }
  }

  private hydrateCloudTaskSessionFromLogs(
    taskId: string,
    taskRunId: string,
    logUrl?: string,
    taskDescription?: string,
  ): void {
    void (async () => {
      const { rawEntries, totalLineCount } = await this.fetchSessionLogs(
        logUrl,
        taskRunId,
      );

      const session = this.d.store.getSessionByTaskId(taskId);
      if (!session || session.taskRunId !== taskRunId) {
        return;
      }

      const events = convertStoredEntriesToEvents(rawEntries);
      const hasUserPrompt = events.some(
        (e: AcpMessage) =>
          isJsonRpcRequest(e.message) && e.message.method === "session/prompt",
      );

      // Seed the optimistic user-message bubble whenever the agent has
      // not yet recorded an initial `session/prompt` request — covers the
      // brand-new task case as well as "agent has emitted lifecycle
      // notifications but hasn't received its first prompt yet". Prefer the
      // stashed initial prompt (which carries the channel CONTEXT.md block, so
      // its chip renders right away) over the bare task description.
      const seedContent =
        this.initialCloudOptimisticPrompt.get(taskId) ?? taskDescription;
      if (!hasUserPrompt && seedContent?.trim()) {
        this.d.store.appendOptimisticItem(taskRunId, {
          type: "user_message",
          content: seedContent,
          timestamp: Date.now(),
        });
      }
      if (hasUserPrompt) {
        // The real prompt has landed; the stash is no longer needed.
        this.initialCloudOptimisticPrompt.delete(taskId);
      }

      if (rawEntries.length === 0) {
        return;
      }

      // If live updates already populated a processed count, don't overwrite
      // that newer state with the persisted baseline fetched during startup.
      if (
        session.processedLineCount !== undefined &&
        session.processedLineCount > 0
      ) {
        return;
      }

      this.d.store.updateSession(taskRunId, {
        events,
        isCloud: true,
        logUrl: logUrl ?? session.logUrl,
        processedLineCount: totalLineCount,
      });
      // Without this the "Galumphing…" indicator stays hidden when the hydrated
      // baseline already contains an in-flight session/prompt — the live delta
      // path otherwise sees delta <= 0 and never re-evaluates the tail.
      this.updatePromptStateFromEvents(taskRunId, events);
    })().catch((err: unknown) => {
      this.d.log.warn("Failed to hydrate cloud task session from logs", {
        taskId,
        taskRunId,
        err,
      });
    });
  }

  private isCurrentCloudTaskWatcher(
    taskId: string,
    runId: string,
    startToken: number,
  ): boolean {
    const watcher = this.cloudTaskWatchers.get(taskId);
    return watcher?.runId === runId && watcher.startToken === startToken;
  }

  /**
   * Fully stop a cloud task watcher. The tRPC subscription unwatches from the
   * main process in its finally handler; the in-flight watch path below sends a
   * compensating unwatch if teardown wins before watch.mutate lands.
   */
  stopCloudTaskWatch(taskId: string): void {
    const watcher = this.cloudTaskWatchers.get(taskId);
    if (!watcher) return;

    watcher.subscription.unsubscribe();
    this.cloudTaskWatchers.delete(taskId);
    this.cloudLogGapReconciler.forgetDeficiency(watcher.runId);
  }

  async preflightToLocal(taskId: string, repoPath: string) {
    const session = this.d.store.getSessionByTaskId(taskId);
    if (!session)
      return {
        canHandoff: false as const,
        localTreeDirty: false as const,
        reason: "No session found",
      };

    const auth = await this.getHandoffAuth();
    if (!auth)
      return {
        canHandoff: false as const,
        localTreeDirty: false as const,
        reason: "Authentication required",
      };

    const preflight = await this.d.trpc.handoff.preflight.query({
      taskId,
      runId: session.taskRunId,
      repoPath,
      apiHost: auth.apiHost,
      teamId: auth.projectId,
    });

    return {
      canHandoff: preflight.canHandoff,
      localTreeDirty: preflight.localTreeDirty,
      localGitState: preflight.localGitState,
      changedFiles: preflight.changedFiles,
      reason: preflight.reason,
    };
  }

  async handoffToLocal(taskId: string, repoPath: string): Promise<void> {
    const session = this.d.store.getSessionByTaskId(taskId);
    if (!session) {
      this.d.log.warn("No session found for handoff", { taskId });
      return;
    }

    const runId = session.taskRunId;
    const auth = await this.getHandoffAuth();
    if (!auth) return;

    this.d.store.updateSession(runId, { handoffInProgress: true });

    try {
      const preflight = await this.runHandoffPreflight(
        taskId,
        runId,
        repoPath,
        auth,
      );
      this.stopCloudTaskWatch(taskId);
      this.d.store.updateSession(runId, { status: "connecting" });
      await this.executeHandoff(
        taskId,
        runId,
        repoPath,
        auth,
        preflight.localGitState,
      );
      this.transitionToLocalSession(runId);
      this.subscribeToChannel(runId);
      await Promise.all([
        this.d.queryClient.refetchQueries({ queryKey: ["tasks"] }),
        this.d.queryClient.refetchQueries({
          queryKey: this.d.WORKSPACE_QUERY_KEY,
        }),
      ]);
      this.d.store.updateSession(runId, { handoffInProgress: false });
      this.d.log.info("Cloud-to-local handoff complete", { taskId, runId });
    } catch (err) {
      this.d.log.error("Handoff failed", { taskId, err });
      this.d.toast.error(
        err instanceof Error ? err.message : "Handoff to local failed",
      );
      this.watchCloudTask(taskId, runId, auth.apiHost, auth.projectId);
      this.d.store.updateSession(runId, {
        handoffInProgress: false,
        status: "disconnected",
      });
    }
  }

  async handoffToCloud(taskId: string, repoPath: string): Promise<void> {
    const session = this.d.store.getSessionByTaskId(taskId);
    if (!session) {
      this.d.log.warn("No session found for cloud handoff", { taskId });
      return;
    }

    const runId = session.taskRunId;
    const auth = await this.getHandoffAuth();
    if (!auth) return;

    this.d.store.updateSession(runId, { handoffInProgress: true });

    try {
      const preflight = await this.d.trpc.handoff.preflightToCloud.query({
        taskId,
        runId,
        repoPath,
      });
      if (!preflight.canHandoff) {
        this.d.store.updateSession(runId, {
          handoffInProgress: false,
        });
        throw new Error(preflight.reason ?? "Cannot hand off to cloud");
      }

      this.unsubscribeFromChannel(runId);
      this.d.store.updateSession(runId, { status: "connecting" });

      const result = await this.d.trpc.handoff.executeToCloud.mutate({
        taskId,
        runId,
        repoPath,
        apiHost: auth.apiHost,
        teamId: auth.projectId,
        localGitState: preflight.localGitState,
      });
      if (!result.success) {
        if (result.code === GITHUB_AUTHORIZATION_REQUIRED_CODE) {
          throw new GitHubAuthorizationRequiredForCloudHandoffError(
            result.error,
          );
        }
        throw new Error(result.error ?? "Handoff to cloud failed");
      }

      this.d.store.updateSession(runId, {
        isCloud: true,
        cloudStatus: undefined,
        cloudStage: undefined,
        cloudOutput: undefined,
        cloudErrorMessage: undefined,
        cloudBranch: undefined,
        status: "disconnected",
        processedLineCount: result.logEntryCount ?? 0,
      });

      this.watchCloudTask(taskId, runId, auth.apiHost, auth.projectId);
      await Promise.all([
        this.d.queryClient.refetchQueries({ queryKey: ["tasks"] }),
        this.d.queryClient.refetchQueries({
          queryKey: this.d.WORKSPACE_QUERY_KEY,
        }),
      ]);
      this.d.store.updateSession(runId, { handoffInProgress: false });
      this.d.log.info("Local-to-cloud handoff complete", { taskId, runId });
    } catch (err) {
      this.d.log.error("Handoff to cloud failed", { taskId, err });
      if (err instanceof GitHubAuthorizationRequiredForCloudHandoffError) {
        await this.startGithubReauthForCloudHandoff(auth.projectId);
      } else {
        this.d.toast.error(
          err instanceof Error ? err.message : "Handoff to cloud failed",
        );
      }
      this.subscribeToChannel(runId);
      this.d.store.updateSession(runId, {
        handoffInProgress: false,
        status: "disconnected",
      });
    }
  }

  private async startGithubReauthForCloudHandoff(
    projectId: number,
  ): Promise<void> {
    const client = await this.d.getAuthenticatedClient();
    if (!client) {
      this.d.toast.error("Sign in before connecting GitHub.");
      return;
    }

    try {
      const { install_url: installUrl } =
        await client.startGithubUserIntegrationConnect(projectId);
      const url = installUrl?.trim();
      if (!url) {
        this.d.toast.error(
          "GitHub connection did not return a URL. Please try again.",
        );
        return;
      }

      await this.d.trpc.os.openExternal.mutate({ url });
      this.d.toast.info(
        "Connect GitHub to continue in cloud",
        "Complete the authorization in your browser, then click Continue again.",
      );
    } catch (error) {
      this.d.toast.error(
        error instanceof Error
          ? error.message
          : "Failed to start GitHub connection",
      );
    }
  }

  private async getHandoffAuth(): Promise<{
    apiHost: string;
    projectId: number;
  } | null> {
    let auth: Awaited<ReturnType<SessionServiceDeps["fetchAuthState"]>>;
    try {
      auth = await this.d.fetchAuthState();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      this.d.toast.error(`Authentication required for handoff: ${message}`);
      return null;
    }
    if (!auth.currentProjectId || !auth.cloudRegion) {
      this.d.toast.error("Missing project configuration for handoff");
      return null;
    }
    return {
      apiHost: getCloudUrlFromRegion(auth.cloudRegion),
      projectId: auth.currentProjectId,
    };
  }

  private async runHandoffPreflight(
    taskId: string,
    runId: string,
    repoPath: string,
    auth: { apiHost: string; projectId: number },
  ): Promise<Awaited<ReturnType<typeof this.d.trpc.handoff.preflight.query>>> {
    const preflight = await this.d.trpc.handoff.preflight.query({
      taskId,
      runId,
      repoPath,
      apiHost: auth.apiHost,
      teamId: auth.projectId,
    });
    if (!preflight.canHandoff) {
      this.d.store.updateSession(runId, {
        handoffInProgress: false,
      });
      throw new Error(preflight.reason ?? "Cannot hand off to local");
    }
    return preflight;
  }

  private async executeHandoff(
    taskId: string,
    runId: string,
    repoPath: string,
    auth: { apiHost: string; projectId: number },
    localGitState?: Awaited<
      ReturnType<typeof this.d.trpc.handoff.preflight.query>
    >["localGitState"],
  ): Promise<void> {
    const result = await this.d.trpc.handoff.execute.mutate({
      taskId,
      runId,
      repoPath,
      apiHost: auth.apiHost,
      teamId: auth.projectId,
      localGitState,
    });
    if (!result.success) {
      throw new Error(result.error ?? "Handoff failed");
    }
  }

  private transitionToLocalSession(runId: string): void {
    this.d.store.updateSession(runId, {
      isCloud: false,
      cloudStatus: undefined,
      cloudStage: undefined,
      cloudOutput: undefined,
      cloudErrorMessage: undefined,
      cloudBranch: undefined,
      status: "connected",
    });
  }

  async retryCloudTaskWatch(taskId: string): Promise<void> {
    const session = this.d.store.getSessionByTaskId(taskId);
    if (!session?.isCloud) {
      throw new Error("No active cloud session for task");
    }

    const previousErrorTitle = session.errorTitle;
    const previousErrorMessage = session.errorMessage;
    const previousErrorRetryable = session.errorRetryable;

    this.d.store.updateSession(session.taskRunId, {
      status: "disconnected",
      errorTitle: undefined,
      errorMessage: undefined,
      errorRetryable: undefined,
      isPromptPending: false,
    });

    try {
      await this.d.trpc.cloudTask.retry.mutate({
        taskId,
        runId: session.taskRunId,
      });
    } catch (error) {
      this.d.store.updateSession(session.taskRunId, {
        status: "error",
        errorTitle: previousErrorTitle,
        errorMessage: previousErrorMessage,
        errorRetryable: previousErrorRetryable,
      });
      throw error;
    }

    // The main-process retry of an already-bootstrapped
    // watcher only reconnects SSE (`start=latest`) and emits no fresh
    // status/snapshot for an idle run, so the update-driven trigger in
    // `handleCloudTaskUpdate` would never fire, the queued message would
    // stay stuck. Attempt the same guarded recovery here once the reconnect
    // request has been accepted. No-ops unless a queue is stranded on an
    // idle, provably-alive run.
    this.tryRecoverIdleCloudQueue(session.taskRunId);
  }

  /**
   * Retries every cloud session whose stream is in the `error` state, i.e. the
   * main process exhausted its SSE reconnect budget and surfaced the manual
   * Retry button. Invoked on window focus so users coming back to the app
   * after a Django deploy, laptop sleep, or network blip don't have to click
   * Retry themselves.
   */
  public retryUnhealthyCloudSessions(): void {
    const sessions = this.d.store.getSessions();
    for (const session of Object.values(sessions)) {
      if (!session.isCloud) continue;
      if (session.status !== "error") continue;
      this.d.log.info("Auto-retrying errored cloud session on focus", {
        taskId: session.taskId,
      });
      this.retryCloudTaskWatch(session.taskId).catch((error) => {
        this.d.log.warn("Auto-retry of errored cloud session failed", {
          taskId: session.taskId,
          error,
        });
      });
    }
  }

  public flushQueuedCloudMessagesAfterAuthRestored(): void {
    const sessions = this.d.store.getSessions();
    for (const session of Object.values(sessions)) {
      if (!session.isCloud || session.messageQueue.length === 0) continue;
      this.scheduleCloudQueueFlush(session.taskId, "auth_restored");
    }
  }

  public countQueuedCloudMessages(): number {
    const sessions = this.d.store.getSessions();
    let count = 0;
    for (const session of Object.values(sessions)) {
      if (!session.isCloud) continue;
      count += session.messageQueue.length;
    }
    return count;
  }

  public updateSessionTaskTitle(taskId: string, taskTitle: string): void {
    const session = this.d.store.getSessionByTaskId(taskId);
    if (!session) return;

    if (session.taskTitle === taskTitle) return;

    this.d.store.updateSession(session.taskRunId, { taskTitle });
  }

  public startActivityHeartbeat(taskRunId: string): () => void {
    const record = () => {
      this.d.trpc.agent.recordActivity.mutate({ taskRunId }).catch(() => {});
    };

    record();
    const existing = this.activityHeartbeats.get(taskRunId);
    if (existing) {
      clearInterval(existing);
    }
    const heartbeat = setInterval(record, ACTIVITY_HEARTBEAT_INTERVAL_MS);
    this.activityHeartbeats.set(taskRunId, heartbeat);

    return () => {
      clearInterval(heartbeat);
      this.activityHeartbeats.delete(taskRunId);
    };
  }

  public reconcileTaskConnection(
    params: ReconcileTaskConnectionParams,
  ): () => void {
    const {
      task,
      session,
      repoPath,
      isCloud,
      isSuspended,
      isOnline,
      cloudAuth,
      onCloudStatusChange,
    } = params;

    if (isCloud) {
      return this.reconcileCloudConnection(
        task,
        cloudAuth,
        onCloudStatusChange,
      );
    }

    if (repoPath) {
      return this.reconcileLocalConnection({
        task,
        session,
        repoPath,
        isOnline,
        isSuspended,
      });
    }

    this.loadLogsOnlyIfDisconnected(task, session);
    return () => {};
  }

  private reconcileCloudConnection(
    task: Task,
    cloudAuth: CloudConnectionAuth,
    onCloudStatusChange?: () => void,
  ): () => void {
    this.updateSessionTaskTitle(
      task.id,
      task.title || task.description || "Cloud Task",
    );

    const runId = task.latest_run?.id;
    if (!runId) return () => {};
    if (cloudAuth.status !== "authenticated") return () => {};
    if (!cloudAuth.bootstrapComplete) return () => {};
    if (!cloudAuth.projectId || !cloudAuth.cloudRegion) return () => {};

    const initialMode =
      typeof task.latest_run?.state?.initial_permission_mode === "string"
        ? task.latest_run.state.initial_permission_mode
        : undefined;
    const adapter =
      task.latest_run?.runtime_adapter === "codex" ? "codex" : "claude";
    const initialModel = task.latest_run?.model ?? undefined;

    return this.watchCloudTask(
      task.id,
      runId,
      getCloudUrlFromRegion(cloudAuth.cloudRegion),
      cloudAuth.projectId,
      onCloudStatusChange,
      task.latest_run?.log_url,
      initialMode,
      adapter,
      initialModel,
      task.description ?? undefined,
    );
  }

  private reconcileLocalConnection(params: {
    task: Task;
    session: ReconcileSessionState | undefined;
    repoPath: string;
    isOnline: boolean;
    isSuspended?: boolean;
  }): () => void {
    const { task, session, repoPath, isOnline, isSuspended } = params;
    const taskId = task.id;

    if (this.reconcilingTasks.has(taskId)) return () => {};
    if (!isOnline) return () => {};
    if (session?.isCloud) return () => {};
    if (isSuspended) return () => {};

    if (session?.status === "error" && session?.idleKilled) {
      const taskRunId = session.taskRunId;
      this.reconcilingTasks.add(taskId);
      this.clearSessionError(taskId, repoPath)
        .catch((error) => {
          this.d.log.error("Auto-reconnect after idle kill failed", { error });
          this.d.store.updateSession(taskRunId, {
            idleKilled: false,
            errorMessage:
              "Session disconnected due to inactivity. Click Retry to reconnect.",
          });
        })
        .finally(() => {
          this.reconcilingTasks.delete(taskId);
        });
      return () => {
        this.reconcilingTasks.delete(taskId);
      };
    }

    if (
      session?.status === "connected" ||
      session?.status === "connecting" ||
      session?.status === "error"
    ) {
      return () => {};
    }

    if (!task.latest_run?.id) return () => {};

    this.reconcilingTasks.add(taskId);
    this.connectToTask({ task, repoPath }).finally(() => {
      this.reconcilingTasks.delete(taskId);
    });

    return () => {
      this.reconcilingTasks.delete(taskId);
    };
  }

  private loadLogsOnlyIfDisconnected(
    task: Task,
    session: ReconcileSessionState | undefined,
  ): void {
    if (session && session.eventCount > 0) return;
    if (!task.latest_run?.id || !task.latest_run?.log_url) return;

    this.loadLogsOnly({
      taskId: task.id,
      taskRunId: task.latest_run.id,
      taskTitle: task.title || task.description || "Task",
      logUrl: task.latest_run.log_url,
    });
  }

  public resolveAllowAlwaysUpgradeMode(
    modeOption: SessionConfigOption | undefined,
  ): string | undefined {
    if (modeOption?.type !== "select") return undefined;
    const availableIds = new Set(
      flattenSelectOptions(modeOption.options).map((opt) => opt.value),
    );
    if (availableIds.has("acceptEdits")) return "acceptEdits";
    if (availableIds.has("auto")) return "auto";
    return undefined;
  }

  public applyAllowAlwaysUpgrade(
    taskId: string,
    modeOption: SessionConfigOption | undefined,
  ): void {
    const upgradeMode = this.resolveAllowAlwaysUpgradeMode(modeOption);
    if (!upgradeMode) return;
    this.setSessionConfigOptionByCategory(taskId, "mode", upgradeMode);
  }

  async resolvePermissionSelection(
    taskId: string,
    permission: PermissionRequest & { toolCallId: string },
    optionId: string,
    modeOption: SessionConfigOption | undefined,
    customInput?: string,
    answers?: Record<string, string>,
  ): Promise<PermissionSelectionPlan> {
    const plan = planPermissionResponse(permission, optionId, customInput);

    if (plan.applyAllowAlwaysUpgrade) {
      this.applyAllowAlwaysUpgrade(taskId, modeOption);
    }

    await this.respondToPermission(
      taskId,
      permission.toolCallId,
      optionId,
      plan.respondWithCustomInput ? customInput : undefined,
      answers,
    );

    return plan;
  }

  async cancelPermissionAndPrompt(
    taskId: string,
    toolCallId: string,
  ): Promise<void> {
    await this.cancelPermission(taskId, toolCallId);
    await this.cancelPrompt(taskId);
  }

  public selectLatestPlan(events: AcpMessage[]): SessionPlan | null {
    return selectLatestPlan(events);
  }

  public maybeRevertBypassMode(
    taskId: string | undefined,
    options: {
      isCloud: boolean;
      allowBypassPermissions: boolean;
      currentModeId: string | boolean | undefined;
    },
  ): void {
    if (options.allowBypassPermissions) return;
    if (options.isCloud) return;
    const isBypass =
      options.currentModeId === "bypassPermissions" ||
      options.currentModeId === "full-access";
    if (!isBypass || !taskId) return;
    this.setSessionConfigOptionByCategory(taskId, "mode", "default");
  }

  /**
   * Drain the cloud queue, the deferral breaks out of
   * the synchronous store-update frame so the dispatcher reads committed
   * state; `sendQueuedCloudMessages` is reentrancy-guarded so stacked
   * schedules from multiple triggers collapse to one.
   */
  private scheduleCloudQueueFlush(taskId: string, reason: string): void {
    if (
      this.scheduledCloudQueueFlushes.has(taskId) ||
      this.dispatchingCloudQueues.has(taskId)
    ) {
      return;
    }

    this.scheduledCloudQueueFlushes.add(taskId);
    setTimeout(() => {
      this.scheduledCloudQueueFlushes.delete(taskId);
      this.sendQueuedCloudMessages(taskId).catch((err) =>
        this.d.log.error("cloud queue flush failed", {
          taskId,
          reason,
          error: err,
        }),
      );
    }, 0);
  }

  /**
   * Guarded recovery for a queued cloud message stranded by a transport
   * drop on an idle, already-bootstrapped run.
   *
   * `run_started` is normally the canonical "agent is ready" trigger and
   * would race with `sendInitialTaskMessage` while still booting, so the
   * safe default remains "drain only once status is connected". But an
   * idle run stays `in_progress` on the server while emitting NO fresh
   * `run_started`/`turn_complete` (those only fire on boot or a new turn).
   * If an SSE transport drop or the `retryCloudTaskWatch` it triggers
   * flipped the session to disconnected/error AFTER the agent already
   * booted for this exact run, nothing flips it back to "connected" and
   * the queued message is stranded forever. When the run is provably
   * alive (`cloudStatus === "in_progress"`) and the agent provably idle
   * for THIS run (`isAgentIdleForRun`), recover readiness and drain.
   */
  private tryRecoverIdleCloudQueue(taskRunId: string): void {
    const session = this.d.store.getSessions()[taskRunId];
    if (!session?.isCloud || session.messageQueue.length === 0) {
      return;
    }
    if (session.cloudStatus !== "in_progress") {
      return;
    }
    if (
      this.scheduledCloudQueueFlushes.has(session.taskId) ||
      this.dispatchingCloudQueues.has(session.taskId)
    ) {
      return;
    }

    const recoverableAfterTransportDrop =
      (session.status === "disconnected" || session.status === "error") &&
      !session.isPromptPending;

    if (session.status !== "connected" && !recoverableAfterTransportDrop) {
      return;
    }

    // A local prompt in flight means a queued follow-up would double-send.
    // The idle scan below is still the real safety check after reconnect.
    if (session.isPromptPending) {
      return;
    }

    // The agent must be provably idle for this run, the
    // connected path included. `status: "connected"` alone is NOT proof of
    // idleness: the `_posthog/run_started` handler flips status to
    // "connected" before the initial/resume turn even starts, so a
    // connected-but-not-idle session is mid-boot. Draining now would race
    // with `sendInitialTaskMessage`/`sendResumeMessage` and one prompt
    // would be cancelled. Only `_posthog/turn_complete` makes the agent
    // idle for the run.
    const idleResult = this.cloudRunIdleTracker.evaluateIdle(session);
    if (!idleResult.idle) {
      return;
    }
    if (idleResult.shouldCacheToStore) {
      this.d.store.updateSession(taskRunId, {
        agentIdleForRunId: taskRunId,
      });
    }

    if (recoverableAfterTransportDrop) {
      this.d.store.updateSession(taskRunId, {
        status: "connected",
        errorTitle: undefined,
        errorMessage: undefined,
      });
      this.d.log.info(
        "Recovered cloud session readiness after transport drop",
        {
          taskId: session.taskId,
          previousStatus: session.status,
        },
      );
    }

    this.scheduleCloudQueueFlush(session.taskId, "idle-run-recovery");
  }

  private handleCloudTaskUpdate(
    taskRunId: string,
    update: CloudTaskUpdatePayload,
  ): void {
    if (update.kind === "error") {
      this.d.store.updateSession(taskRunId, {
        status: "error",
        errorTitle: update.errorTitle,
        errorMessage:
          update.errorMessage ??
          "Lost connection to the cloud run. Retry to reconnect.",
        errorRetryable: update.retryable,
        isPromptPending: false,
      });
      return;
    }

    if (update.kind === "permission_request") {
      this.handleCloudPermissionRequest(taskRunId, update);
      return;
    }

    // Append new log entries with dedup guard
    if (
      (update.kind === "logs" || update.kind === "snapshot") &&
      update.newEntries.length > 0
    ) {
      // Cloud streams deliver `session/update` notifications as regular log
      // entries rather than live ACP messages. Without this, config changes
      // made mid-run (e.g. plan-approval switching to bypassPermissions) never
      // reach the session store and the footer mode selector stays stale.
      const latestConfigOptions = extractLatestConfigOptionsFromEntries(
        update.newEntries,
      );
      if (latestConfigOptions) {
        this.d.store.updateSession(taskRunId, {
          configOptions: latestConfigOptions,
        });
        this.d.setPersistedConfigOptions(taskRunId, latestConfigOptions);
      }

      const session = this.d.store.getSessions()[taskRunId];
      const currentCount = session?.processedLineCount ?? 0;
      const expectedCount = update.totalEntryCount;
      const plan = classifyCloudLogAppend(
        currentCount,
        expectedCount,
        update.newEntries.length,
      );

      if (plan.kind === "caught-up") {
        // Already caught up — skip duplicate entries
      } else if (plan.kind === "append-tail") {
        const entriesToAppend = update.newEntries.slice(-plan.tailCount);
        let newEvents = convertStoredEntriesToEvents(entriesToAppend);
        newEvents = this.filterSkippedPromptEvents(
          taskRunId,
          session,
          newEvents,
        );
        if (hasSessionPromptEvent(newEvents)) {
          this.d.store.clearTailOptimisticItems(taskRunId);
        }
        this.d.store.appendEvents(taskRunId, newEvents, expectedCount);
        this.updatePromptStateFromEvents(taskRunId, newEvents, {
          isLive: update.kind === "logs",
        });
      } else {
        this.cloudLogGapReconciler.reconcile({
          taskId: update.taskId,
          taskRunId,
          expectedCount,
          currentCount,
          newEntries: update.newEntries,
          logUrl: session?.logUrl,
        });
      }
    }

    if (update.kind === "snapshot" && !isTerminalStatus(update.status)) {
      this.surfacePersistedPendingPermissions(taskRunId, update.newEntries);
    }

    // NOTE: Don't auto-flush on `!isPromptPending && queue.length > 0` here.
    // Setup-phase log batches (`_posthog/progress`, `_posthog/console`) stream
    // in BEFORE the agent emits its initial `session/prompt` request, so
    // `isPromptPending` is still false during those batches — firing the
    // dispatcher then races with the agent's initial `clientConnection.prompt`.
    // The canonical "agent is idle" signal is `_posthog/turn_complete`, which
    // is handled in `updatePromptStateFromEvents`.

    // Update cloud status fields if present
    if (update.kind === "status" || update.kind === "snapshot") {
      this.d.store.updateCloudStatus(taskRunId, {
        status: update.status,
        stage: update.stage,
        output: update.output,
        errorMessage: update.errorMessage,
        branch: update.branch,
      });

      if (update.status === "in_progress") {
        this.tryRecoverIdleCloudQueue(taskRunId);
      }

      if (isTerminalStatus(update.status)) {
        // Clean up any pending resume messages that couldn't be sent
        const session = this.d.store.getSessions()[taskRunId];
        if (
          session &&
          (session.messageQueue.length > 0 || session.isPromptPending)
        ) {
          this.d.store.clearMessageQueue(session.taskId);
          this.d.store.updateSession(taskRunId, {
            isPromptPending: false,
          });
        }
        this.stopCloudTaskWatch(update.taskId);
      }
    }
  }

  /**
   * Filter out session/prompt events that should be skipped during resume.
   * When resuming a cloud run, the initial session/prompt from the new run's
   * logs would duplicate the optimistic user bubble we already added.
   */
  // Note: `session` is a snapshot from the start of handleCloudTaskUpdate.
  // The updateSession call below makes it stale, but this is safe because
  // skipPolledPromptCount is only ever 1, so this method runs at most once.
  private filterSkippedPromptEvents(
    taskRunId: string,
    session: AgentSession | undefined,
    events: AcpMessage[],
  ): AcpMessage[] {
    const plan = planSkippedPromptFilter(
      session?.skipPolledPromptCount,
      events,
    );
    if (!plan) {
      return events;
    }

    this.d.store.updateSession(taskRunId, {
      skipPolledPromptCount: plan.remainingSkipCount,
    });
    return plan.events;
  }

  // --- Helper Methods ---

  private async getAuthCredentialsStatus(): Promise<AuthCredentialsStatus> {
    const authState = await this.d.fetchAuthState();
    // `bootstrapComplete === false` also covers the pre-initialize window where
    // status is still the default "anonymous" but auth has not resolved yet.
    if (
      authState.status === "restoring" ||
      authState.bootstrapComplete === false
    ) {
      return { kind: "restoring" };
    }

    const apiHost = authState.cloudRegion
      ? getCloudUrlFromRegion(authState.cloudRegion)
      : null;
    const projectId = authState.currentProjectId;
    const client = this.d.createAuthenticatedClient(authState);

    if (!apiHost || !projectId || !client) return { kind: "missing" };
    return { kind: "ready", auth: { apiHost, projectId, client } };
  }

  private queueRestoringCloudPrompt(
    session: AgentSession,
    prompt: string | ContentBlock[],
    reason: string,
  ): { stopReason: "queued" } {
    const transport = this.d.h.getCloudPromptTransport(prompt);
    this.d.store.enqueueMessage(session.taskId, transport.promptText, prompt);
    this.d.log.info(reason, {
      taskId: session.taskId,
      queueLength: session.messageQueue.length + 1,
    });
    return { stopReason: "queued" };
  }

  private parseLogContent(content: string): ParsedSessionLogs {
    return parseSessionLogContent(content, {
      onParseError: (line) =>
        this.d.log.warn("Failed to parse log entry", { line }),
    });
  }

  private async fetchSessionLogs(
    logUrl: string | undefined,
    taskRunId?: string,
    options: { minEntryCount?: number } = {},
  ): Promise<ParsedSessionLogs> {
    const empty: ParsedSessionLogs = {
      rawEntries: [],
      totalLineCount: 0,
      parseFailureCount: 0,
    };
    if (!logUrl && !taskRunId) return empty;
    let localResult: ParsedSessionLogs | undefined;

    if (taskRunId) {
      try {
        const localContent = await this.d.trpc.logs.readLocalLogs.query({
          taskRunId,
        });
        if (localContent?.trim()) {
          localResult = this.parseLogContent(localContent);
          if (
            !options.minEntryCount ||
            localResult.totalLineCount >= options.minEntryCount
          ) {
            return localResult;
          }
        }
      } catch {
        this.d.log.warn("Failed to read local logs, falling back to S3", {
          taskRunId,
        });
      }
    }

    if (!logUrl) return localResult ?? empty;

    try {
      const content = await this.d.trpc.logs.fetchS3Logs.query({ logUrl });
      if (!content?.trim()) return localResult ?? empty;

      const result = this.parseLogContent(content);

      if (taskRunId && result.rawEntries.length > 0) {
        this.d.trpc.logs.writeLocalLogs
          .mutate({ taskRunId, content })
          .catch((err: unknown) => {
            this.d.log.warn("Failed to cache S3 logs locally", {
              taskRunId,
              err,
            });
          });
      }

      if (
        localResult &&
        localResult.rawEntries.length > result.rawEntries.length
      ) {
        return localResult;
      }

      return result;
    } catch {
      return localResult ?? empty;
    }
  }

  private commitReconciledCloudEvents(
    taskRunId: string,
    rawEntries: StoredLogEntry[],
    logUrl: string | undefined,
    processedLineCount: number,
  ): void {
    const events = convertStoredEntriesToEvents(rawEntries);
    if (hasSessionPromptEvent(events)) {
      this.d.store.clearTailOptimisticItems(taskRunId);
    }
    this.cloudRunIdleTracker.delete(taskRunId);
    this.d.store.updateSession(taskRunId, {
      events,
      isCloud: true,
      logUrl,
      processedLineCount,
    });
    this.updatePromptStateFromEvents(taskRunId, events);
  }

  private getSessionByRunId(taskRunId: string): AgentSession | undefined {
    const sessions = this.d.store.getSessions();
    return sessions[taskRunId];
  }

  private async appendAndPersist(
    taskId: string,
    session: AgentSession,
    event: AcpMessage,
    storedEntry: StoredLogEntry,
  ): Promise<void> {
    // Don't update processedLineCount - it tracks S3 log lines, not local events
    this.d.store.appendEvents(session.taskRunId, [event]);

    const client = await this.d.getAuthenticatedClient();
    if (client) {
      try {
        await client.appendTaskRunLog(taskId, session.taskRunId, [storedEntry]);
      } catch (error) {
        this.d.log.warn("Failed to persist event to logs", { error });
      }
    }
  }
}
