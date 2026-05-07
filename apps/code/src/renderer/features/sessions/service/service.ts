import type {
  ContentBlock,
  RequestPermissionRequest,
  SessionConfigOption,
} from "@agentclientprotocol/sdk";
import {
  createAuthenticatedClient,
  getAuthenticatedClient,
} from "@features/auth/hooks/authClient";
import { fetchAuthState } from "@features/auth/hooks/authQueries";
import { useUsageLimitStore } from "@features/billing/stores/usageLimitStore";
import { useSessionAdapterStore } from "@features/sessions/stores/sessionAdapterStore";
import {
  getPersistedConfigOptions,
  removePersistedConfigOptions,
  setPersistedConfigOptions,
  updatePersistedConfigOptionValue,
} from "@features/sessions/stores/sessionConfigStore";
import type {
  Adapter,
  AgentSession,
  PermissionRequest,
} from "@features/sessions/stores/sessionStore";
import {
  flattenSelectOptions,
  getConfigOptionByCategory,
  mergeConfigOptions,
  sessionStoreSetters,
} from "@features/sessions/stores/sessionStore";
import { useSettingsStore } from "@features/settings/stores/settingsStore";
import { taskViewedApi } from "@features/sidebar/hooks/useTaskViewed";
import { extractSkillButtonId } from "@features/skill-buttons/prompts";
import { isNotification, POSTHOG_NOTIFICATIONS } from "@posthog/agent";
import {
  getAvailableCodexModes,
  getAvailableModes,
} from "@posthog/agent/execution-mode";
import { DEFAULT_GATEWAY_MODEL } from "@posthog/agent/gateway-models";
import { getIsOnline } from "@renderer/stores/connectivityStore";
import { trpc } from "@renderer/trpc";
import { trpcClient } from "@renderer/trpc/client";
import { toast } from "@renderer/utils/toast";
import {
  type CloudTaskPermissionRequestUpdate,
  type CloudTaskUpdatePayload,
  type EffortLevel,
  type ExecutionMode,
  effortLevelSchema,
  isTerminalStatus,
  type Task,
  type TaskRun,
} from "@shared/types";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import type { CloudRunSource, PrAuthorshipMode } from "@shared/types/cloud";
import type { AcpMessage, StoredLogEntry } from "@shared/types/session-events";
import { isJsonRpcRequest } from "@shared/types/session-events";
import { getBackoffDelay } from "@shared/utils/backoff";
import { getCloudUrlFromRegion } from "@shared/utils/urls";
import { buildPermissionToolMetadata, track } from "@utils/analytics";
import { logger } from "@utils/logger";
import {
  notifyPermissionRequest,
  notifyPromptComplete,
} from "@utils/notifications";
import { queryClient } from "@utils/queryClient";
import {
  convertStoredEntriesToEvents,
  createUserPromptEvent,
  createUserShellExecuteEvent,
  extractPromptText,
  getUserShellExecutesSinceLastPrompt,
  isFatalSessionError,
  isRateLimitError,
  normalizePromptToBlocks,
  shellExecutesToContextBlocks,
} from "@utils/session";
import {
  cloudPromptToBlocks,
  combineQueuedCloudPrompts,
  getCloudPromptTransport,
  uploadRunAttachments,
  uploadTaskStagedAttachments,
} from "../utils/cloudArtifacts";

const log = logger.scope("session-service");
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

class GitHubAuthorizationRequiredForCloudHandoffError extends Error {
  constructor(
    message = "Connect GitHub before continuing this task in cloud.",
  ) {
    super(message);
    this.name = "GitHubAuthorizationRequiredForCloudHandoffError";
  }
}

/**
 * Build default configOptions for cloud sessions so the mode switcher
 * is available in the UI even without a local agent connection.
 *
 * The `extra` options (model, thought_level) come from the preview-config
 * trpc query, which is async. Callers populate them by calling
 * `fetchAndApplyCloudPreviewOptions` after the session exists in the store.
 */
function extractLatestConfigOptionsFromEntries(
  entries: StoredLogEntry[],
): SessionConfigOption[] | undefined {
  let latest: SessionConfigOption[] | undefined;
  for (const entry of entries) {
    if (
      entry.type !== "notification" ||
      entry.notification?.method !== "session/update"
    ) {
      continue;
    }
    const params = entry.notification.params as
      | {
          update?: {
            sessionUpdate?: string;
            configOptions?: SessionConfigOption[];
          };
        }
      | undefined;
    if (
      params?.update?.sessionUpdate === "config_option_update" &&
      params.update.configOptions
    ) {
      latest = params.update.configOptions;
    }
  }
  return latest;
}

function hasSessionPromptEvent(events: AcpMessage[]): boolean {
  return events.some(
    (event) =>
      isJsonRpcRequest(event.message) &&
      event.message.method === "session/prompt",
  );
}

function buildCloudDefaultConfigOptions(
  initialMode: string | undefined,
  adapter: Adapter = "claude",
  extra: SessionConfigOption[] = [],
): SessionConfigOption[] {
  const modes =
    adapter === "codex" ? getAvailableCodexModes() : getAvailableModes();
  const currentMode =
    typeof initialMode === "string"
      ? initialMode
      : adapter === "codex"
        ? "auto"
        : "plan";
  return [
    {
      id: "mode",
      name: "Approval Preset",
      type: "select",
      currentValue: currentMode,
      options: modes.map((mode) => ({
        value: mode.id,
        name: mode.name,
      })),
      category: "mode" as SessionConfigOption["category"],
      description: "Choose an approval and sandboxing preset for your session",
    },
    ...extra,
  ];
}

function isCloudTurnCompleteEvent(event: AcpMessage): boolean {
  const msg = event.message;
  return (
    "method" in msg &&
    isNotification(msg.method, POSTHOG_NOTIFICATIONS.TURN_COMPLETE)
  );
}

interface AuthCredentials {
  apiHost: string;
  projectId: number;
  client: NonNullable<Awaited<ReturnType<typeof getAuthenticatedClient>>>;
}

interface CloudLogGapReconcileRequest {
  taskId: string;
  taskRunId: string;
  expectedCount: number;
  currentCount: number;
  newEntries: StoredLogEntry[];
  logUrl?: string;
}

interface CloudLogGapReconcileState {
  pendingRequest?: CloudLogGapReconcileRequest;
}

export interface ConnectParams {
  task: Task;
  repoPath: string;
  initialPrompt?: ContentBlock[];
  executionMode?: ExecutionMode;
  adapter?: "claude" | "codex";
  model?: string;
  reasoningLevel?: string;
}

// --- Singleton Service Instance ---

let serviceInstance: SessionService | null = null;

export function getSessionService(): SessionService {
  if (!serviceInstance) {
    serviceInstance = new SessionService();
  }
  return serviceInstance;
}

export function resetSessionService(): void {
  if (serviceInstance) {
    serviceInstance.reset();
    serviceInstance = null;
  }

  sessionStoreSetters.clearAll();

  trpcClient.agent.resetAll.mutate().catch((err) => {
    log.error("Failed to reset all sessions on main process", err);
  });
}

export class SessionService {
  private connectingTasks = new Map<string, Promise<void>>();
  private localRepoPaths = new Map<string, string>();
  private localRecoveryAttempts = new Map<string, Promise<boolean>>();
  /** Re-entrance guard for cloud queue dispatch (per taskId). */
  private dispatchingCloudQueues = new Set<string>();
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
  private cloudLogGapReconciles = new Map<string, CloudLogGapReconcileState>();
  /** Maps toolCallId → cloud requestId for routing permission responses */
  private cloudPermissionRequestIds = new Map<string, string>();
  private idleKilledSubscription: { unsubscribe: () => void } | null = null;
  /**
   * Cached preview-config-options responses keyed by `${apiHost}::${adapter}`.
   * Shared across cloud sessions so switching model/adapter reuses the list.
   */
  private previewConfigOptionsCache = new Map<
    string,
    Promise<SessionConfigOption[]>
  >();

  constructor() {
    this.idleKilledSubscription =
      trpcClient.agent.onSessionIdleKilled.subscribe(undefined, {
        onData: (event: { taskRunId: string }) => {
          const { taskRunId } = event;
          log.info("Session idle-killed by main process", { taskRunId });
          this.handleIdleKill(taskRunId);
        },
        onError: (err: unknown) => {
          log.debug("Idle-killed subscription error", { error: err });
        },
      });
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
    const existingSession = sessionStoreSetters.getSessionByTaskId(taskId);
    if (existingSession?.status === "connected") {
      log.info("Already connected to task", { taskId });
      return;
    }
    if (existingSession?.status === "connecting") {
      log.info("Session already in connecting state", { taskId });
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
      log.info("Skipping local session connect for cloud run", {
        taskId,
        taskRunId: latestRun.id,
      });
      return;
    }

    try {
      const auth = await this.getAuthCredentials();
      if (!auth) {
        log.error("Missing auth credentials");
        const taskRunId = latestRun?.id ?? `error-${taskId}`;
        const session = this.createBaseSession(taskRunId, taskId, taskTitle);
        session.status = "error";
        session.errorMessage =
          "Authentication required. Please sign in to continue.";
        if (initialPrompt?.length) {
          session.initialPrompt = initialPrompt;
        }
        sessionStoreSetters.setSession(session);
        return;
      }

      if (latestRun?.id && latestRun?.log_url) {
        if (!getIsOnline()) {
          log.info("Skipping connection attempt - offline", { taskId });
          const { rawEntries } = await this.fetchSessionLogs(
            latestRun.log_url,
            latestRun.id,
          );
          const events = convertStoredEntriesToEvents(rawEntries);
          const session = this.createBaseSession(
            latestRun.id,
            taskId,
            taskTitle,
          );
          session.events = events;
          session.logUrl = latestRun.log_url;
          session.status = "disconnected";
          session.errorMessage =
            "No internet connection. Connect when you're back online.";
          sessionStoreSetters.setSession(session);
          return;
        }

        const [workspaceResult, logResult] = await Promise.all([
          trpcClient.workspace.verify.query({ taskId }),
          this.fetchSessionLogs(latestRun.log_url, latestRun.id),
        ]);

        if (!workspaceResult.exists) {
          log.warn("Workspace no longer exists, showing error state", {
            taskId,
            missingPath: workspaceResult.missingPath,
          });
          const events = convertStoredEntriesToEvents(logResult.rawEntries);
          const session = this.createBaseSession(
            latestRun.id,
            taskId,
            taskTitle,
          );
          session.events = events;
          session.logUrl = latestRun.log_url;
          session.status = "error";
          session.errorMessage = workspaceResult.missingPath
            ? `Working directory no longer exists: ${workspaceResult.missingPath}`
            : "The working directory for this task no longer exists. Please start a new session.";
          sessionStoreSetters.setSession(session);
          return;
        }

        await this.reconnectToLocalSession(
          taskId,
          latestRun.id,
          taskTitle,
          latestRun.log_url,
          repoPath,
          auth,
          logResult,
        );
      } else {
        if (!getIsOnline()) {
          log.info("Skipping connection attempt - offline", { taskId });
          const taskRunId = latestRun?.id ?? `offline-${taskId}`;
          const session = this.createBaseSession(taskRunId, taskId, taskTitle);
          session.status = "disconnected";
          session.errorMessage =
            "No internet connection. Connect when you're back online.";
          sessionStoreSetters.setSession(session);
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
      log.error("Failed to connect to task", { message });

      const taskRunId = latestRun?.id ?? `error-${taskId}`;
      const session = this.createBaseSession(taskRunId, taskId, taskTitle);
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

      const shouldAutoRetry = getIsOnline();
      session.status = shouldAutoRetry ? "connecting" : "error";
      if (!shouldAutoRetry) {
        session.errorTitle = "Failed to connect";
        session.errorMessage = message;
      }
      sessionStoreSetters.setSession(session);

      if (!shouldAutoRetry) return;

      let lastRetryMessage = message;
      let wentOffline = false;
      for (let attempt = 1; attempt <= AUTO_RETRY_MAX_ATTEMPTS; attempt++) {
        log.warn("Auto-retrying failed connection", {
          taskId,
          attempt,
          delayMs: AUTO_RETRY_DELAY_MS,
        });
        await new Promise((resolve) =>
          setTimeout(resolve, AUTO_RETRY_DELAY_MS),
        );
        if (!getIsOnline()) {
          log.warn("Skipping retry — device went offline", {
            taskId,
            attempt,
          });
          wentOffline = true;
          break;
        }
        try {
          await this.clearSessionError(taskId, repoPath);
          return;
        } catch (retryError) {
          lastRetryMessage =
            retryError instanceof Error
              ? retryError.message
              : String(retryError);
          log.error("Auto-retry via clearSessionError failed", {
            taskId,
            attempt,
            error: lastRetryMessage,
          });
        }
      }

      const currentSession = sessionStoreSetters.getSessionByTaskId(taskId);
      if (!currentSession) return;
      sessionStoreSetters.updateSession(currentSession.taskRunId, {
        status: wentOffline ? "disconnected" : "error",
        errorTitle: wentOffline ? undefined : "Failed to connect",
        errorMessage: wentOffline
          ? "No internet connection. Connect when you're back online."
          : lastRetryMessage || message,
      });
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

    const storedAdapter = useSessionAdapterStore
      .getState()
      .getAdapter(taskRunId);
    const resolvedAdapter = adapter ?? storedAdapter;
    const persistedConfigOptions = getPersistedConfigOptions(taskRunId);

    const session = this.createBaseSession(taskRunId, taskId, taskTitle);
    session.events = events;
    if (logUrl) {
      session.logUrl = logUrl;
    }
    if (persistedConfigOptions) {
      session.configOptions = persistedConfigOptions;
    }
    if (resolvedAdapter) {
      session.adapter = resolvedAdapter;
      useSessionAdapterStore.getState().setAdapter(taskRunId, resolvedAdapter);
    }

    sessionStoreSetters.setSession(session);
    this.subscribeToChannel(taskRunId);

    try {
      const modeOpt = getConfigOptionByCategory(persistedConfigOptions, "mode");
      const persistedMode =
        modeOpt?.type === "select" ? modeOpt.currentValue : undefined;

      trpcClient.workspace.verify
        .query({ taskId })
        .then((workspaceResult) => {
          if (!workspaceResult.exists) {
            log.warn("Workspace no longer exists", {
              taskId,
              missingPath: workspaceResult.missingPath,
            });
            sessionStoreSetters.updateSession(taskRunId, {
              status: "error",
              errorMessage: workspaceResult.missingPath
                ? `Working directory no longer exists: ${workspaceResult.missingPath}`
                : "The working directory for this task no longer exists. Please start a new session.",
            });
          }
        })
        .catch((err) => {
          log.warn("Failed to verify workspace", { taskId, err });
        });

      const { customInstructions } = useSettingsStore.getState();
      const result = await trpcClient.agent.reconnect.mutate({
        taskId,
        taskRunId,
        repoPath,
        apiHost: auth.apiHost,
        projectId: auth.projectId,
        logUrl,
        sessionId,
        adapter: resolvedAdapter,
        permissionMode: persistedMode,
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

        sessionStoreSetters.updateSession(taskRunId, {
          status: "connected",
          configOptions,
        });

        // Persist the merged config options
        if (configOptions) {
          setPersistedConfigOptions(taskRunId, configOptions);
        }

        // Restore persisted config options to server in parallel
        if (persistedConfigOptions) {
          await Promise.all(
            persistedConfigOptions.map((opt) =>
              trpcClient.agent.setConfigOption
                .mutate({
                  sessionId: taskRunId,
                  configId: opt.id,
                  value: String(opt.currentValue),
                })
                .catch((error) => {
                  log.warn(
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
        log.warn("Reconnect returned null", { taskId, taskRunId });
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
      log.warn("Reconnect failed", { taskId, error: errorMessage });
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
      await trpcClient.agent.cancel.mutate({ sessionId: taskRunId });
    } catch (error) {
      log.debug("Cancel during teardown failed (session may already be gone)", {
        taskRunId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    this.unsubscribeFromChannel(taskRunId);
    sessionStoreSetters.removeSession(taskRunId);
    if (session) {
      this.localRepoPaths.delete(session.taskId);
      this.localRecoveryAttempts.delete(session.taskId);
    }
    useSessionAdapterStore.getState().removeAdapter(taskRunId);
    removePersistedConfigOptions(taskRunId);
  }

  /**
   * Handle an idle-kill from the main process without destroying session state.
   * The main process already cleaned up the agent, so we only need to
   * unsubscribe from the channel and mark the session as errored.
   * Preserves events, logUrl, configOptions and adapter so that Retry
   * can reconnect with full context via unstable_resumeSession.
   */
  private handleIdleKill(taskRunId: string): void {
    this.unsubscribeFromChannel(taskRunId);
    sessionStoreSetters.updateSession(taskRunId, {
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
    const existing = sessionStoreSetters.getSessionByTaskId(taskId);
    const session = this.createBaseSession(taskRunId, taskId, taskTitle);
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
    sessionStoreSetters.setSession(session);
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
    const session = sessionStoreSetters.getSessionByTaskId(taskId);
    if (!repoPath || !session || session.isCloud) {
      return false;
    }

    log.warn("Attempting automatic local session recovery", {
      taskId,
      taskRunId,
      reason,
    });

    sessionStoreSetters.updateSession(taskRunId, {
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
      const currentSession = sessionStoreSetters.getSessionByTaskId(taskId);
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
        log.info("Automatic local session recovery succeeded", {
          taskId,
          taskRunId,
          attempt: attempt + 1,
        });
        return true;
      }
    }

    const latestSession = sessionStoreSetters.getSessionByTaskId(taskId);
    if (latestSession?.taskRunId === taskRunId) {
      this.setErrorSession(
        taskId,
        taskRunId,
        latestSession.taskTitle,
        LOCAL_SESSION_RECOVERY_FAILED_MESSAGE,
        "Connection lost",
      );
    }

    log.warn("Automatic local session recovery exhausted", {
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

        const latestSession = sessionStoreSetters.getSessionByTaskId(taskId);
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

    const { customInstructions: startCustomInstructions } =
      useSettingsStore.getState();
    const preferredModel = model ?? DEFAULT_GATEWAY_MODEL;
    const result = await trpcClient.agent.start.mutate({
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

    const session = this.createBaseSession(taskRun.id, taskId, taskTitle);
    session.channel = result.channel;
    session.status = "connected";
    session.adapter = adapter;
    const configOptions = result.configOptions as
      | SessionConfigOption[]
      | undefined;
    session.configOptions = configOptions;

    // Persist the config options
    if (configOptions) {
      setPersistedConfigOptions(taskRun.id, configOptions);
    }

    // Persist the adapter
    if (adapter) {
      useSessionAdapterStore.getState().setAdapter(taskRun.id, adapter);
    }

    // Store the initial prompt on the session so retry/reset flows can
    // re-send it if the session errors after this point (e.g. subscription
    // error, agent crash, or prompt failure).
    if (initialPrompt?.length) {
      session.initialPrompt = initialPrompt;
    }

    sessionStoreSetters.setSession(session);
    this.subscribeToChannel(taskRun.id);

    track(ANALYTICS_EVENTS.TASK_RUN_STARTED, {
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
    const existing = sessionStoreSetters.getSessionByTaskId(taskId);
    if (existing && existing.events.length > 0) return;

    const { rawEntries } = await this.fetchSessionLogs(logUrl, taskRunId);
    const events = convertStoredEntriesToEvents(rawEntries);
    const session = this.createBaseSession(taskRunId, taskId, taskTitle);
    session.events = events;
    session.logUrl = logUrl;
    session.status = "disconnected";
    sessionStoreSetters.setSession(session);
  }

  async disconnectFromTask(taskId: string): Promise<void> {
    const session = sessionStoreSetters.getSessionByTaskId(taskId);
    if (!session) return;

    await this.teardownSession(session.taskRunId);
  }

  // --- Subscription Management ---

  private subscribeToChannel(taskRunId: string): void {
    if (this.subscriptions.has(taskRunId)) {
      return;
    }

    const eventSubscription = trpcClient.agent.onSessionEvent.subscribe(
      { taskRunId },
      {
        onData: (payload: unknown) => {
          this.handleSessionEvent(taskRunId, payload as AcpMessage);
        },
        onError: (err) => {
          log.error("Session subscription error", { taskRunId, error: err });
          const session = this.getSessionByRunId(taskRunId);
          if (!session || session.isCloud) {
            sessionStoreSetters.updateSession(taskRunId, {
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
      trpcClient.agent.onPermissionRequest.subscribe(
        { taskRunId },
        {
          onData: async (payload) => {
            this.handlePermissionRequest(taskRunId, payload);
          },
          onError: (err) => {
            log.error("Permission subscription error", {
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
  }

  /**
   * Reset all service state and clean up subscriptions.
   * Called on logout or app reset.
   */
  reset(): void {
    log.info("Resetting session service", {
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
    this.cloudLogGapReconciles.clear();
    this.dispatchingCloudQueues.clear();
    this.idleKilledSubscription?.unsubscribe();
    this.idleKilledSubscription = null;
  }

  private updatePromptStateFromEvents(
    taskRunId: string,
    events: AcpMessage[],
  ): void {
    for (const acpMsg of events) {
      const msg = acpMsg.message;
      if (isJsonRpcRequest(msg) && msg.method === "session/prompt") {
        sessionStoreSetters.updateSession(taskRunId, {
          isPromptPending: true,
          promptStartedAt: acpMsg.ts,
          pausedDurationMs: 0,
          currentPromptId: msg.id,
        });
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
        const session = sessionStoreSetters.getSessions()[taskRunId];
        if (session && session.currentPromptId !== msg.id) {
          continue;
        }
        sessionStoreSetters.updateSession(taskRunId, {
          isPromptPending: false,
          promptStartedAt: null,
          currentPromptId: null,
        });
      }
      if (isCloudTurnCompleteEvent(acpMsg)) {
        sessionStoreSetters.updateSession(taskRunId, {
          isPromptPending: false,
          promptStartedAt: null,
          currentPromptId: null,
        });
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
        const session = sessionStoreSetters.getSessions()[taskRunId];
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
          sessionStoreSetters.updateSession(taskRunId, updates);
        }
      }
      // Canonical "turn boundary" — flush any queued cloud messages now
      // that the agent is idle and accepting the next prompt.
      if (
        "method" in msg &&
        isNotification(msg.method, POSTHOG_NOTIFICATIONS.TURN_COMPLETE)
      ) {
        const session = sessionStoreSetters.getSessions()[taskRunId];
        if (session?.isCloud) {
          // Backward compat: treat turn_complete as an implicit run_started
          // for agents that predate the run_started notification.
          if (session.status !== "connected") {
            sessionStoreSetters.updateSession(taskRunId, {
              status: "connected",
            });
          }
          if (session.messageQueue.length > 0) {
            const taskId = session.taskId;
            setTimeout(() => {
              this.sendQueuedCloudMessages(taskId).catch((err) =>
                log.error("turn_complete-driven cloud queue flush failed", {
                  taskId,
                  error: err,
                }),
              );
            }, 0);
          }
        }
      }
    }
  }

  private handleSessionEvent(taskRunId: string, acpMsg: AcpMessage): void {
    const session = sessionStoreSetters.getSessions()[taskRunId];
    if (!session) return;

    const isUserPromptEcho =
      isJsonRpcRequest(acpMsg.message) &&
      acpMsg.message.method === "session/prompt";

    // Once the agent starts responding, clear initialPrompt so that
    // retry reconnects to this session instead of creating a new one.
    if (!isUserPromptEcho && session.initialPrompt?.length) {
      sessionStoreSetters.updateSession(taskRunId, {
        initialPrompt: undefined,
      });
    }

    if (isUserPromptEcho) {
      sessionStoreSetters.replaceOptimisticWithEvent(taskRunId, acpMsg);
    } else {
      sessionStoreSetters.appendEvents(taskRunId, [acpMsg]);
    }
    this.updatePromptStateFromEvents(taskRunId, [acpMsg]);

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
        notifyPromptComplete(session.taskTitle, stopReason, session.taskId);
      }

      taskViewedApi.markActivity(session.taskId);
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
        sessionStoreSetters.updateSession(taskRunId, {
          configOptions,
        });
        // Persist the updated config options
        setPersistedConfigOptions(taskRunId, configOptions);
        log.info("Session config options updated", { taskRunId });
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
          sessionStoreSetters.updateSession(taskRunId, {
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
        sessionStoreSetters.updateSession(taskRunId, {
          adapter: params.adapter,
        });
        useSessionAdapterStore.getState().setAdapter(taskRunId, params.adapter);
      }
    }

    if (
      "method" in msg &&
      "params" in msg &&
      isNotification(msg.method, POSTHOG_NOTIFICATIONS.STATUS)
    ) {
      const params = msg.params as { status?: string; isComplete?: boolean };
      if (params?.status === "compacting") {
        sessionStoreSetters.updateSession(taskRunId, {
          isCompacting: !params.isComplete,
        });
      }
    }

    if (
      "method" in msg &&
      isNotification(msg.method, POSTHOG_NOTIFICATIONS.COMPACT_BOUNDARY)
    ) {
      sessionStoreSetters.updateSession(taskRunId, {
        isCompacting: false,
      });

      this.drainQueuedMessages(taskRunId, session);
    }
  }

  private drainQueuedMessages(
    taskRunId: string,
    session: AgentSession,
  ): boolean {
    const freshSession = sessionStoreSetters.getSessions()[taskRunId];
    const hasQueuedMessages =
      freshSession &&
      freshSession.messageQueue.length > 0 &&
      freshSession.status === "connected";

    if (hasQueuedMessages) {
      setTimeout(() => {
        this.sendQueuedMessages(session.taskId).catch((err) => {
          log.error("Failed to send queued messages", {
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
    log.info("Permission request received in renderer", {
      taskRunId,
      toolCallId: payload.toolCall.toolCallId,
      title: payload.toolCall.title,
    });

    // Get fresh session state
    const session = sessionStoreSetters.getSessions()[taskRunId];
    if (!session) {
      log.warn("Session not found for permission request", {
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

    sessionStoreSetters.setPendingPermissions(taskRunId, newPermissions);
    taskViewedApi.markActivity(session.taskId);
    notifyPermissionRequest(session.taskTitle, session.taskId);
  }

  private handleCloudPermissionRequest(
    taskRunId: string,
    update: CloudTaskPermissionRequestUpdate,
  ): void {
    log.info("Cloud permission request received", {
      taskRunId,
      requestId: update.requestId,
      toolCallId: update.toolCall.toolCallId,
      title: update.toolCall.title,
    });

    const session = sessionStoreSetters.getSessions()[taskRunId];
    if (!session) {
      log.warn("Session not found for cloud permission request", { taskRunId });
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

    sessionStoreSetters.setPendingPermissions(taskRunId, newPermissions);
    taskViewedApi.markActivity(session.taskId);
    notifyPermissionRequest(session.taskTitle, session.taskId);
  }

  // --- Prompt Handling ---

  /**
   * Send a prompt to the agent.
   * Queues if a prompt is already pending.
   */
  async sendPrompt(
    taskId: string,
    prompt: string | ContentBlock[],
  ): Promise<{ stopReason: string }> {
    if (!getIsOnline()) {
      throw new Error(
        "No internet connection. Please check your connection and try again.",
      );
    }

    const session = sessionStoreSetters.getSessionByTaskId(taskId);
    if (!session) throw new Error("No active session for task");

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
      sessionStoreSetters.enqueueMessage(taskId, promptText);
      log.info("Message queued", {
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
    track(ANALYTICS_EVENTS.PROMPT_SENT, {
      task_id: taskId,
      is_initial: session.events.length === 0,
      execution_type: "local",
      prompt_length_chars: promptText.length,
    });

    return this.sendLocalPrompt(session, blocks, promptText);
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
    const combinedText = sessionStoreSetters.dequeueMessagesAsText(taskId);
    if (!combinedText) {
      return { stopReason: "skipped" };
    }

    const session = sessionStoreSetters.getSessionByTaskId(taskId);
    if (!session) {
      log.warn("No session found for queued messages, messages lost", {
        taskId,
        lostMessageLength: combinedText.length,
      });
      return { stopReason: "no_session" };
    }

    log.info("Sending queued messages as single prompt", {
      taskId,
      promptLength: combinedText.length,
    });

    let blocks = normalizePromptToBlocks(combinedText);

    const shellExecutes = getUserShellExecutesSinceLastPrompt(session.events);
    if (shellExecutes.length > 0) {
      const contextBlocks = shellExecutesToContextBlocks(shellExecutes);
      blocks = [...contextBlocks, ...blocks];
    }

    track(ANALYTICS_EVENTS.PROMPT_SENT, {
      task_id: taskId,
      is_initial: false,
      execution_type: "local",
      prompt_length_chars: combinedText.length,
    });

    try {
      return await this.sendLocalPrompt(session, blocks, combinedText);
    } catch (error) {
      // Log that queued messages were lost due to send failure
      log.error("Failed to send queued messages, messages lost", {
        taskId,
        lostMessageLength: combinedText.length,
        error,
      });
      throw error;
    }
  }

  private async sendLocalPrompt(
    session: AgentSession,
    blocks: ContentBlock[],
    promptText: string,
  ): Promise<{ stopReason: string }> {
    sessionStoreSetters.updateSession(session.taskRunId, {
      isPromptPending: true,
      promptStartedAt: Date.now(),
      pausedDurationMs: 0,
    });

    const skillButtonId = extractSkillButtonId(blocks);
    if (skillButtonId) {
      sessionStoreSetters.appendOptimisticItem(session.taskRunId, {
        type: "skill_button_action",
        buttonId: skillButtonId,
      });
    } else {
      sessionStoreSetters.appendOptimisticItem(session.taskRunId, {
        type: "user_message",
        content: promptText,
        timestamp: Date.now(),
      });
    }

    try {
      const result = await trpcClient.agent.prompt.mutate({
        sessionId: session.taskRunId,
        prompt: blocks,
      });
      sessionStoreSetters.updateSession(session.taskRunId, {
        isPromptPending: false,
        promptStartedAt: null,
      });
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorDetails = (error as { data?: { details?: string } }).data
        ?.details;

      sessionStoreSetters.clearOptimisticItems(session.taskRunId);

      if (isRateLimitError(errorMessage, errorDetails)) {
        log.warn("Rate limit exceeded, showing usage limit modal", {
          taskRunId: session.taskRunId,
        });
        sessionStoreSetters.updateSession(session.taskRunId, {
          isPromptPending: false,
          promptStartedAt: null,
        });
        useUsageLimitStore.getState().show();
        return { stopReason: "rate_limited" };
      }

      if (isFatalSessionError(errorMessage, errorDetails)) {
        log.error("Fatal prompt error, attempting recovery", {
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
        sessionStoreSetters.updateSession(session.taskRunId, {
          isPromptPending: false,
          isCompacting: false,
          promptStartedAt: null,
        });
      }

      throw error;
    }
  }

  /**
   * Cancel the current prompt.
   */
  async cancelPrompt(taskId: string): Promise<boolean> {
    const session = sessionStoreSetters.getSessionByTaskId(taskId);
    if (!session) return false;

    sessionStoreSetters.updateSession(session.taskRunId, {
      isPromptPending: false,
      promptStartedAt: null,
    });

    if (session.isCloud) {
      return this.cancelCloudPrompt(session);
    }

    try {
      const result = await trpcClient.agent.cancelPrompt.mutate({
        sessionId: session.taskRunId,
      });

      const durationSeconds = Math.round(
        (Date.now() - session.startedAt) / 1000,
      );
      const promptCount = session.events.filter(
        (e) => "method" in e.message && e.message.method === "session/prompt",
      ).length;
      track(ANALYTICS_EVENTS.TASK_RUN_CANCELLED, {
        task_id: taskId,
        execution_type: "local",
        duration_seconds: durationSeconds,
        prompts_sent: promptCount,
      });

      return result;
    } catch (error) {
      log.error("Failed to cancel prompt", error);
      return false;
    }
  }

  // --- Cloud Commands ---

  private async sendCloudPrompt(
    session: AgentSession,
    prompt: string | ContentBlock[],
    options?: { skipQueueGuard?: boolean },
  ): Promise<{ stopReason: string }> {
    const transport = getCloudPromptTransport(prompt);
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
      sessionStoreSetters.enqueueMessage(session.taskId, transport.promptText);
      sessionStoreSetters.updateSession(session.taskRunId, {
        isPromptPending: true,
      });
      log.info("Cloud message queued (sandbox not ready)", {
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
      sessionStoreSetters.enqueueMessage(
        session.taskId,
        transport.promptText,
        prompt,
      );
      log.info("Cloud message queued (agent not ready)", {
        taskId: session.taskId,
        sessionStatus: session.status,
        queueLength: session.messageQueue.length + 1,
      });
      return { stopReason: "queued" };
    }

    if (!options?.skipQueueGuard && session.isPromptPending) {
      sessionStoreSetters.enqueueMessage(
        session.taskId,
        transport.promptText,
        prompt,
      );
      log.info("Cloud message queued", {
        taskId: session.taskId,
        queueLength: session.messageQueue.length + 1,
      });
      return { stopReason: "queued" };
    }

    const [auth, cloudCommandAuth] = await Promise.all([
      this.getAuthCredentials(),
      this.getCloudCommandAuth(),
    ]);
    if (!auth || !cloudCommandAuth) {
      throw new Error("Authentication required for cloud commands");
    }

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

    const artifactIds = await uploadRunAttachments(
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

    sessionStoreSetters.updateSession(session.taskRunId, {
      isPromptPending: true,
      promptStartedAt: Date.now(),
      pausedDurationMs: 0,
    });
    sessionStoreSetters.appendOptimisticItem(session.taskRunId, {
      type: "user_message",
      content: transport.promptText,
      timestamp: Date.now(),
      pinToTop: false,
    });

    track(ANALYTICS_EVENTS.PROMPT_SENT, {
      task_id: session.taskId,
      is_initial: session.events.length === 0,
      execution_type: "cloud",
      prompt_length_chars: transport.promptText.length,
    });

    try {
      const result = await trpcClient.cloudTask.sendCommand.mutate({
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
      sessionStoreSetters.updateSession(session.taskRunId, {
        isPromptPending: false,
        promptStartedAt: null,
      });
      sessionStoreSetters.clearTailOptimisticItems(session.taskRunId);
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
      const session = sessionStoreSetters.getSessionByTaskId(taskId);
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

      const drained = sessionStoreSetters.dequeueMessages(taskId);
      const combined = combineQueuedCloudPrompts(drained);
      if (!combined) return;

      log.info("Sending queued cloud messages", {
        taskId,
        drainedCount: drained.length,
      });

      try {
        await this.sendCloudPrompt(session, combined, {
          skipQueueGuard: true,
        });
      } catch (err) {
        log.warn("Cloud queue dispatch failed; re-enqueueing", {
          taskId,
          error: String(err),
        });
        sessionStoreSetters.prependQueuedMessages(taskId, drained);
      }
    } finally {
      this.dispatchingCloudQueues.delete(taskId);
    }
  }

  private async resumeCloudRun(
    session: AgentSession,
    prompt: string | ContentBlock[],
  ): Promise<{ stopReason: string }> {
    const authCredentials = await this.getAuthCredentials();
    if (!authCredentials) {
      throw new Error("Authentication required for cloud commands");
    }
    const auth = await this.getCloudCommandAuth();
    if (!auth) {
      throw new Error("Authentication required for cloud commands");
    }

    const transport = getCloudPromptTransport(prompt);
    if (!transport.messageText && transport.filePaths.length === 0) {
      return { stopReason: "empty" };
    }
    const artifactIds = await uploadTaskStagedAttachments(
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
    const prAuthorshipMode = this.getCloudPrAuthorshipMode(previousState);

    log.info("Creating resume run for terminal cloud task", {
      taskId: session.taskId,
      previousRunId: session.taskRunId,
      previousStatus: session.cloudStatus,
    });

    const runtimeOptions = this.getCloudRuntimeOptions(session, previousRun);

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
        runSource: this.getCloudRunSource(previousState),
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
    const newSession = this.createBaseSession(
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
          ? cloudPromptToBlocks(prompt)
          : [{ type: "text", text: transport.promptText }],
        Date.now(),
      ),
    ];
    newSession.processedLineCount = 0;
    // Skip the first session/prompt from polled logs — we already have the
    // optimistic user event, so showing the polled one would duplicate it.
    newSession.skipPolledPromptCount = 1;
    sessionStoreSetters.setSession(newSession);

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
    queryClient.invalidateQueries({ queryKey: ["tasks"] });

    track(ANALYTICS_EVENTS.PROMPT_SENT, {
      task_id: session.taskId,
      is_initial: false,
      execution_type: "cloud",
      prompt_length_chars: transport.promptText.length,
    });

    return { stopReason: "queued" };
  }

  private async cancelCloudPrompt(session: AgentSession): Promise<boolean> {
    if (isTerminalStatus(session.cloudStatus)) {
      log.info("Skipping cancel for terminal cloud run", {
        taskId: session.taskId,
        status: session.cloudStatus,
      });
      return false;
    }

    const auth = await this.getCloudCommandAuth();
    if (!auth) {
      log.error("No auth for cloud cancel");
      return false;
    }

    try {
      const result = await trpcClient.cloudTask.sendCommand.mutate({
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
      track(ANALYTICS_EVENTS.TASK_RUN_CANCELLED, {
        task_id: session.taskId,
        execution_type: "cloud",
        duration_seconds: durationSeconds,
        prompts_sent: promptCount,
      });

      if (!result.success) {
        log.warn("Cloud cancel command failed", { error: result.error });
        return false;
      }

      return true;
    } catch (error) {
      log.error("Failed to cancel cloud prompt", error);
      return false;
    }
  }

  private async getCloudCommandAuth(): Promise<{
    apiHost: string;
    teamId: number;
  } | null> {
    const authState = await fetchAuthState();
    if (!authState.cloudRegion || !authState.projectId) return null;
    return {
      apiHost: getCloudUrlFromRegion(authState.cloudRegion),
      teamId: authState.projectId,
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
    await trpcClient.cloudTask.sendCommand.mutate({
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
    sessionStoreSetters.setPendingPermissions(
      session.taskRunId,
      newPermissions,
    );

    if (permission?.receivedAt) {
      sessionStoreSetters.updateSession(session.taskRunId, {
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
    const session = sessionStoreSetters.getSessionByTaskId(taskId);
    if (!session) {
      log.error("No session found for permission response", { taskId });
      return;
    }

    const permission = session.pendingPermissions.get(toolCallId);
    track(ANALYTICS_EVENTS.PERMISSION_RESPONDED, {
      task_id: taskId,
      ...buildPermissionToolMetadata(permission, optionId, customInput),
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
        await trpcClient.agent.respondToPermission.mutate({
          taskRunId: session.taskRunId,
          toolCallId,
          optionId,
          customInput,
          answers,
        });
      }

      log.info("Permission response sent", {
        taskId,
        toolCallId,
        optionId,
        isCloud: !!cloudRequestId,
        hasCustomInput: !!customInput,
      });
    } catch (error) {
      log.error("Failed to respond to permission", {
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
    const session = sessionStoreSetters.getSessionByTaskId(taskId);
    if (!session) {
      log.error("No session found for permission cancellation", { taskId });
      return;
    }

    const permission = session.pendingPermissions.get(toolCallId);
    track(ANALYTICS_EVENTS.PERMISSION_CANCELLED, {
      task_id: taskId,
      ...buildPermissionToolMetadata(permission),
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
        await trpcClient.agent.cancelPermission.mutate({
          taskRunId: session.taskRunId,
          toolCallId,
        });
      }

      log.info("Permission cancelled", {
        taskId,
        toolCallId,
        isCloud: !!cloudRequestId,
      });
    } catch (error) {
      log.error("Failed to cancel permission", {
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
    const session = sessionStoreSetters.getSessionByTaskId(taskId);
    if (!session) return;

    // Find the config option and save previous value for rollback
    const configOptions = session.configOptions ?? [];
    const optionIndex = configOptions.findIndex((opt) => opt.id === configId);
    if (optionIndex === -1) {
      log.warn("Config option not found", { taskId, configId });
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
    sessionStoreSetters.updateSession(session.taskRunId, {
      configOptions: updatedOptions,
    });
    updatePersistedConfigOptionValue(session.taskRunId, configId, value);

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
        await trpcClient.agent.setConfigOption.mutate({
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
      sessionStoreSetters.updateSession(session.taskRunId, {
        configOptions: rolledBackOptions,
      });
      updatePersistedConfigOptionValue(
        session.taskRunId,
        configId,
        String(previousValue),
      );
      log.error("Failed to set session config option", {
        taskId,
        configId,
        value,
        error,
      });
      toast.error("Failed to change setting. Please try again.");
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
    const session = sessionStoreSetters.getSessionByTaskId(taskId);
    if (!session) return;

    const configOption = getConfigOptionByCategory(
      session.configOptions,
      category,
    );
    if (!configOption) {
      log.warn("Config option not found for category", { taskId, category });
      return;
    }

    if (configOption.currentValue !== value) {
      track(ANALYTICS_EVENTS.SESSION_CONFIG_CHANGED, {
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
    const session = sessionStoreSetters.getSessionByTaskId(taskId);
    if (!session) return;

    const event = createUserShellExecuteEvent(command, cwd, undefined, id);
    sessionStoreSetters.appendEvents(session.taskRunId, [event]);
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
    const session = sessionStoreSetters.getSessionByTaskId(taskId);
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
    const session = sessionStoreSetters.getSessionByTaskId(taskId);
    if (session?.initialPrompt?.length) {
      const { taskTitle, initialPrompt } = session;
      await this.teardownSession(session.taskRunId);
      const auth = await this.getAuthCredentials();
      if (!auth) {
        throw new Error(
          "Unable to reach server. Please check your connection.",
        );
      }
      await this.createNewLocalSession(
        taskId,
        taskTitle,
        repoPath,
        auth,
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
    const session = sessionStoreSetters.getSessionByTaskId(taskId);
    if (!session) return false;

    const { taskRunId, taskTitle, logUrl } = session;

    // Cancel lingering backend agent (ignore errors — it may not exist
    // after a failed reconnect)
    try {
      await trpcClient.agent.cancel.mutate({ sessionId: taskRunId });
    } catch {
      // expected when backend has no session
    }
    this.unsubscribeFromChannel(taskRunId);

    const auth = await this.getAuthCredentials();
    if (!auth) {
      throw new Error("Unable to reach server. Please check your connection.");
    }

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
    let pending = this.previewConfigOptionsCache.get(cacheKey);
    if (!pending) {
      pending = trpcClient.agent.getPreviewConfigOptions
        .query({ apiHost, adapter })
        .catch((err: unknown) => {
          log.warn("Failed to fetch preview config options for cloud session", {
            apiHost,
            adapter,
            error: err,
          });
          this.previewConfigOptionsCache.delete(cacheKey);
          return [] as SessionConfigOption[];
        });
      this.previewConfigOptionsCache.set(cacheKey, pending);
    }

    const previewOptions = await pending;
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

    const session = sessionStoreSetters.getSessions()[taskRunId];
    if (!session) return;

    const existingOptions = session.configOptions ?? [];
    const existingIds = new Set(existingOptions.map((o) => o.id));
    const newExtras = extras.filter((o) => !existingIds.has(o.id));
    if (newExtras.length === 0) return;
    const merged = [...existingOptions, ...newExtras];

    sessionStoreSetters.updateSession(taskRunId, { configOptions: merged });
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
      const existing = sessionStoreSetters.getSessionByTaskId(taskId);
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
          sessionStoreSetters.updateSession(existing.taskRunId, {
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

    // Different run — full cleanup of old watcher first
    if (existingWatcher) {
      this.stopCloudTaskWatch(taskId);
    }

    const startToken = ++this.nextCloudTaskWatchToken;

    // Create session in the store
    const existing = sessionStoreSetters.getSessionByTaskId(taskId);
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
      const session = this.createBaseSession(taskRunId, taskId, taskTitle);
      session.status = "disconnected";
      session.isCloud = true;
      session.adapter = adapter;
      session.configOptions = buildCloudDefaultConfigOptions(
        initialMode,
        adapter,
      );
      sessionStoreSetters.setSession(session);
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
        sessionStoreSetters.updateSession(existing.taskRunId, updates);
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
    const subscription = trpcClient.cloudTask.onUpdate.subscribe(
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
          log.error("Cloud task subscription error", { taskId, err }),
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

        await trpcClient.cloudTask.watch.mutate({
          taskId,
          runId,
          apiHost,
          teamId,
        });

        // If the local watcher was torn down while the watch request was in
        // flight, send a compensating unwatch after the start request lands.
        if (!this.isCurrentCloudTaskWatcher(taskId, runId, startToken)) {
          await trpcClient.cloudTask.unwatch.mutate({ taskId, runId });
        }
      } catch (err: unknown) {
        if (!this.isCurrentCloudTaskWatcher(taskId, runId, startToken)) {
          return;
        }
        log.warn("Failed to start cloud task watcher", { taskId, err });
      }
    })();

    return () => {};
  }

  private hydrateCloudTaskSessionFromLogs(
    taskId: string,
    taskRunId: string,
    logUrl?: string,
    taskDescription?: string,
  ): void {
    void (async () => {
      const { rawEntries } = await this.fetchSessionLogs(logUrl, taskRunId);

      const session = sessionStoreSetters.getSessionByTaskId(taskId);
      if (!session || session.taskRunId !== taskRunId) {
        return;
      }

      const events = convertStoredEntriesToEvents(rawEntries);
      const hasUserPrompt = events.some(
        (e) =>
          isJsonRpcRequest(e.message) && e.message.method === "session/prompt",
      );

      // Seed the optimistic user-message bubble whenever the agent has
      // not yet recorded an initial `session/prompt` request — covers the
      // brand-new task case as well as "agent has emitted lifecycle
      // notifications but hasn't received its first prompt yet".
      if (!hasUserPrompt && taskDescription?.trim()) {
        sessionStoreSetters.appendOptimisticItem(taskRunId, {
          type: "user_message",
          content: taskDescription,
          timestamp: Date.now(),
        });
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

      sessionStoreSetters.updateSession(taskRunId, {
        events,
        isCloud: true,
        logUrl: logUrl ?? session.logUrl,
        processedLineCount: rawEntries.length,
      });
      // Without this the "Galumphing…" indicator stays hidden when the hydrated
      // baseline already contains an in-flight session/prompt — the live delta
      // path otherwise sees delta <= 0 and never re-evaluates the tail.
      this.updatePromptStateFromEvents(taskRunId, events);
    })().catch((err: unknown) => {
      log.warn("Failed to hydrate cloud task session from logs", {
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
  }

  async preflightToLocal(taskId: string, repoPath: string) {
    const session = sessionStoreSetters.getSessionByTaskId(taskId);
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

    const preflight = await trpcClient.handoff.preflight.query({
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
    const session = sessionStoreSetters.getSessionByTaskId(taskId);
    if (!session) {
      log.warn("No session found for handoff", { taskId });
      return;
    }

    const runId = session.taskRunId;
    const auth = await this.getHandoffAuth();
    if (!auth) return;

    sessionStoreSetters.updateSession(runId, { handoffInProgress: true });

    try {
      const preflight = await this.runHandoffPreflight(
        taskId,
        runId,
        repoPath,
        auth,
      );
      this.stopCloudTaskWatch(taskId);
      sessionStoreSetters.updateSession(runId, { status: "connecting" });
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
        queryClient.refetchQueries({ queryKey: ["tasks"] }),
        queryClient.refetchQueries(trpc.workspace.getAll.pathFilter()),
      ]);
      sessionStoreSetters.updateSession(runId, { handoffInProgress: false });
      log.info("Cloud-to-local handoff complete", { taskId, runId });
    } catch (err) {
      log.error("Handoff failed", { taskId, err });
      toast.error(
        err instanceof Error ? err.message : "Handoff to local failed",
      );
      this.watchCloudTask(taskId, runId, auth.apiHost, auth.projectId);
      sessionStoreSetters.updateSession(runId, {
        handoffInProgress: false,
        status: "disconnected",
      });
    }
  }

  async handoffToCloud(taskId: string, repoPath: string): Promise<void> {
    const session = sessionStoreSetters.getSessionByTaskId(taskId);
    if (!session) {
      log.warn("No session found for cloud handoff", { taskId });
      return;
    }

    const runId = session.taskRunId;
    const auth = await this.getHandoffAuth();
    if (!auth) return;

    sessionStoreSetters.updateSession(runId, { handoffInProgress: true });

    try {
      const preflight = await trpcClient.handoff.preflightToCloud.query({
        taskId,
        runId,
        repoPath,
      });
      if (!preflight.canHandoff) {
        sessionStoreSetters.updateSession(runId, {
          handoffInProgress: false,
        });
        throw new Error(preflight.reason ?? "Cannot hand off to cloud");
      }

      this.unsubscribeFromChannel(runId);
      sessionStoreSetters.updateSession(runId, { status: "connecting" });

      const result = await trpcClient.handoff.executeToCloud.mutate({
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

      sessionStoreSetters.updateSession(runId, {
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
        queryClient.refetchQueries({ queryKey: ["tasks"] }),
        queryClient.refetchQueries(trpc.workspace.getAll.pathFilter()),
      ]);
      sessionStoreSetters.updateSession(runId, { handoffInProgress: false });
      log.info("Local-to-cloud handoff complete", { taskId, runId });
    } catch (err) {
      log.error("Handoff to cloud failed", { taskId, err });
      if (err instanceof GitHubAuthorizationRequiredForCloudHandoffError) {
        await this.startGithubReauthForCloudHandoff(auth.projectId);
      } else {
        toast.error(
          err instanceof Error ? err.message : "Handoff to cloud failed",
        );
      }
      this.subscribeToChannel(runId);
      sessionStoreSetters.updateSession(runId, {
        handoffInProgress: false,
        status: "disconnected",
      });
    }
  }

  private async startGithubReauthForCloudHandoff(
    projectId: number,
  ): Promise<void> {
    const client = await getAuthenticatedClient();
    if (!client) {
      toast.error("Sign in before connecting GitHub.");
      return;
    }

    try {
      const { install_url: installUrl } =
        await client.startGithubUserIntegrationConnect(projectId);
      const url = installUrl?.trim();
      if (!url) {
        toast.error(
          "GitHub connection did not return a URL. Please try again.",
        );
        return;
      }

      await trpcClient.os.openExternal.mutate({ url });
      toast.info(
        "Connect GitHub to continue in cloud",
        "Complete the authorization in your browser, then click Continue again.",
      );
    } catch (error) {
      toast.error(
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
    let auth: Awaited<ReturnType<typeof fetchAuthState>>;
    try {
      auth = await fetchAuthState();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error(`Authentication required for handoff: ${message}`);
      return null;
    }
    if (!auth.projectId || !auth.cloudRegion) {
      toast.error("Missing project configuration for handoff");
      return null;
    }
    return {
      apiHost: getCloudUrlFromRegion(auth.cloudRegion),
      projectId: auth.projectId,
    };
  }

  private async runHandoffPreflight(
    taskId: string,
    runId: string,
    repoPath: string,
    auth: { apiHost: string; projectId: number },
  ): Promise<Awaited<ReturnType<typeof trpcClient.handoff.preflight.query>>> {
    const preflight = await trpcClient.handoff.preflight.query({
      taskId,
      runId,
      repoPath,
      apiHost: auth.apiHost,
      teamId: auth.projectId,
    });
    if (!preflight.canHandoff) {
      sessionStoreSetters.updateSession(runId, {
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
      ReturnType<typeof trpcClient.handoff.preflight.query>
    >["localGitState"],
  ): Promise<void> {
    const result = await trpcClient.handoff.execute.mutate({
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
    sessionStoreSetters.updateSession(runId, {
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
    const session = sessionStoreSetters.getSessionByTaskId(taskId);
    if (!session?.isCloud) {
      throw new Error("No active cloud session for task");
    }

    const previousErrorTitle = session.errorTitle;
    const previousErrorMessage = session.errorMessage;

    sessionStoreSetters.updateSession(session.taskRunId, {
      status: "disconnected",
      errorTitle: undefined,
      errorMessage: undefined,
      isPromptPending: false,
    });

    try {
      await trpcClient.cloudTask.retry.mutate({
        taskId,
        runId: session.taskRunId,
      });
    } catch (error) {
      sessionStoreSetters.updateSession(session.taskRunId, {
        status: "error",
        errorTitle: previousErrorTitle,
        errorMessage: previousErrorMessage,
      });
      throw error;
    }
  }

  public updateSessionTaskTitle(taskId: string, taskTitle: string): void {
    const session = sessionStoreSetters.getSessionByTaskId(taskId);
    if (!session) return;

    if (session.taskTitle === taskTitle) return;

    sessionStoreSetters.updateSession(session.taskRunId, { taskTitle });
  }

  private handleCloudTaskUpdate(
    taskRunId: string,
    update: CloudTaskUpdatePayload,
  ): void {
    if (update.kind === "error") {
      sessionStoreSetters.updateSession(taskRunId, {
        status: "error",
        errorTitle: update.errorTitle,
        errorMessage:
          update.errorMessage ??
          "Lost connection to the cloud run. Retry to reconnect.",
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
        sessionStoreSetters.updateSession(taskRunId, {
          configOptions: latestConfigOptions,
        });
        setPersistedConfigOptions(taskRunId, latestConfigOptions);
      }

      const session = sessionStoreSetters.getSessions()[taskRunId];
      const currentCount = session?.processedLineCount ?? 0;
      const expectedCount = update.totalEntryCount;
      const delta = expectedCount - currentCount;

      if (delta <= 0) {
        // Already caught up — skip duplicate entries
      } else if (delta <= update.newEntries.length) {
        // Normal case: append only the tail (last `delta` entries)
        const entriesToAppend = update.newEntries.slice(-delta);
        let newEvents = convertStoredEntriesToEvents(entriesToAppend);
        newEvents = this.filterSkippedPromptEvents(
          taskRunId,
          session,
          newEvents,
        );
        if (hasSessionPromptEvent(newEvents)) {
          sessionStoreSetters.clearTailOptimisticItems(taskRunId);
        }
        sessionStoreSetters.appendEvents(taskRunId, newEvents, expectedCount);
        this.updatePromptStateFromEvents(taskRunId, newEvents);
      } else {
        this.reconcileCloudLogGap({
          taskId: update.taskId,
          taskRunId,
          expectedCount,
          currentCount,
          newEntries: update.newEntries,
          logUrl: session?.logUrl,
        });
      }
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
      sessionStoreSetters.updateCloudStatus(taskRunId, {
        status: update.status,
        stage: update.stage,
        output: update.output,
        errorMessage: update.errorMessage,
        branch: update.branch,
      });

      // No cloudStatus="in_progress" auto-flush here. `run_started` from
      // the agent-server is the canonical "agent is ready" trigger and
      // handles both initial boot and post-restart recovery; firing
      // earlier would race with `sendInitialTaskMessage`.

      if (isTerminalStatus(update.status)) {
        // Clean up any pending resume messages that couldn't be sent
        const session = sessionStoreSetters.getSessions()[taskRunId];
        if (
          session &&
          (session.messageQueue.length > 0 || session.isPromptPending)
        ) {
          sessionStoreSetters.clearMessageQueue(session.taskId);
          sessionStoreSetters.updateSession(taskRunId, {
            isPromptPending: false,
          });
        }
        this.stopCloudTaskWatch(update.taskId);
      }
    }
  }

  private getCloudPrAuthorshipMode(
    state: Record<string, unknown>,
  ): PrAuthorshipMode {
    const explicitMode = state.pr_authorship_mode;
    if (explicitMode === "user" || explicitMode === "bot") {
      return explicitMode;
    }
    return state.run_source === "signal_report" ? "bot" : "user";
  }

  private getCloudRunSource(state: Record<string, unknown>): CloudRunSource {
    return state.run_source === "signal_report" ? "signal_report" : "manual";
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
    if (!session?.skipPolledPromptCount || session.skipPolledPromptCount <= 0) {
      return events;
    }

    const promptIdx = events.findIndex(
      (e) =>
        isJsonRpcRequest(e.message) && e.message.method === "session/prompt",
    );
    if (promptIdx !== -1) {
      const filtered = [...events];
      filtered.splice(promptIdx, 1);
      sessionStoreSetters.updateSession(taskRunId, {
        skipPolledPromptCount: (session.skipPolledPromptCount ?? 0) - 1,
      });
      return filtered;
    }

    return events;
  }

  // --- Helper Methods ---

  private async getAuthCredentials(): Promise<AuthCredentials | null> {
    const authState = await fetchAuthState();
    const apiHost = authState.cloudRegion
      ? getCloudUrlFromRegion(authState.cloudRegion)
      : null;
    const projectId = authState.projectId;
    const client = createAuthenticatedClient(authState);

    if (!apiHost || !projectId || !client) return null;
    return { apiHost, projectId, client };
  }

  private getCloudRuntimeOptions(
    session: AgentSession,
    previousRun?: TaskRun,
  ): {
    adapter?: Adapter;
    model?: string;
    reasoningLevel?: string;
  } {
    const modelOption = getConfigOptionByCategory(
      session.configOptions,
      "model",
    );
    const thoughtLevelOption = getConfigOptionByCategory(
      session.configOptions,
      "thought_level",
    );

    return {
      adapter: session.adapter ?? previousRun?.runtime_adapter ?? undefined,
      model:
        typeof modelOption?.currentValue === "string"
          ? modelOption.currentValue
          : (previousRun?.model ?? undefined),
      reasoningLevel:
        typeof thoughtLevelOption?.currentValue === "string"
          ? thoughtLevelOption.currentValue
          : (previousRun?.reasoning_effort ?? undefined),
    };
  }

  private parseLogContent(content: string): {
    rawEntries: StoredLogEntry[];
    sessionId?: string;
    adapter?: Adapter;
  } {
    const rawEntries: StoredLogEntry[] = [];
    let sessionId: string | undefined;
    let adapter: Adapter | undefined;

    for (const line of content.trim().split("\n")) {
      try {
        const stored = JSON.parse(line) as StoredLogEntry;
        rawEntries.push(stored);

        if (
          stored.type === "notification" &&
          stored.notification?.method?.endsWith("posthog/sdk_session")
        ) {
          const params = stored.notification.params as {
            sessionId?: string;
            sdkSessionId?: string;
            adapter?: Adapter;
          };
          if (params?.sessionId) sessionId = params.sessionId;
          else if (params?.sdkSessionId) sessionId = params.sdkSessionId;
          if (params?.adapter) adapter = params.adapter;
        }
      } catch {
        log.warn("Failed to parse log entry", { line });
      }
    }

    return { rawEntries, sessionId, adapter };
  }

  private async fetchSessionLogs(
    logUrl: string | undefined,
    taskRunId?: string,
    options: { minEntryCount?: number } = {},
  ): Promise<{
    rawEntries: StoredLogEntry[];
    sessionId?: string;
    adapter?: Adapter;
  }> {
    if (!logUrl && !taskRunId) return { rawEntries: [] };
    let localResult:
      | {
          rawEntries: StoredLogEntry[];
          sessionId?: string;
          adapter?: Adapter;
        }
      | undefined;

    if (taskRunId) {
      try {
        const localContent = await trpcClient.logs.readLocalLogs.query({
          taskRunId,
        });
        if (localContent?.trim()) {
          localResult = this.parseLogContent(localContent);
          if (
            !options.minEntryCount ||
            localResult.rawEntries.length >= options.minEntryCount
          ) {
            return localResult;
          }
        }
      } catch {
        log.warn("Failed to read local logs, falling back to S3", {
          taskRunId,
        });
      }
    }

    if (!logUrl) return localResult ?? { rawEntries: [] };

    try {
      const content = await trpcClient.logs.fetchS3Logs.query({ logUrl });
      if (!content?.trim()) return localResult ?? { rawEntries: [] };

      const result = this.parseLogContent(content);

      if (taskRunId && result.rawEntries.length > 0) {
        trpcClient.logs.writeLocalLogs
          .mutate({ taskRunId, content })
          .catch((err) => {
            log.warn("Failed to cache S3 logs locally", { taskRunId, err });
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
      return localResult ?? { rawEntries: [] };
    }
  }

  private reconcileCloudLogGap(request: CloudLogGapReconcileRequest): void {
    const { taskId, taskRunId } = request;
    const reconcileKey = `${taskId}:${taskRunId}`;
    const existing = this.cloudLogGapReconciles.get(reconcileKey);
    if (existing) {
      existing.pendingRequest = this.mergeCloudLogGapRequests(
        existing.pendingRequest,
        request,
      );
      return;
    }

    this.cloudLogGapReconciles.set(reconcileKey, {});
    void this.runCloudLogGapReconciles(reconcileKey, request)
      .catch((err: unknown) => {
        log.warn("Failed to reconcile cloud task log gap", {
          taskId,
          taskRunId,
          err,
        });
      })
      .finally(() => {
        this.cloudLogGapReconciles.delete(reconcileKey);
      });
  }

  private mergeCloudLogGapRequests(
    current: CloudLogGapReconcileRequest | undefined,
    next: CloudLogGapReconcileRequest,
  ): CloudLogGapReconcileRequest {
    if (!current) return next;

    return {
      taskId: next.taskId,
      taskRunId: next.taskRunId,
      currentCount: Math.min(current.currentCount, next.currentCount),
      expectedCount: Math.max(current.expectedCount, next.expectedCount),
      newEntries: [...current.newEntries, ...next.newEntries],
      logUrl: next.logUrl ?? current.logUrl,
    };
  }

  private async runCloudLogGapReconciles(
    reconcileKey: string,
    initialRequest: CloudLogGapReconcileRequest,
  ): Promise<void> {
    let request: CloudLogGapReconcileRequest | undefined = initialRequest;

    while (request) {
      await this.reconcileCloudLogGapOnce(request);
      const state = this.cloudLogGapReconciles.get(reconcileKey);
      request = state?.pendingRequest;
      if (state) {
        state.pendingRequest = undefined;
      }
    }
  }

  private async reconcileCloudLogGapOnce({
    taskId,
    taskRunId,
    expectedCount,
    currentCount,
    newEntries,
    logUrl,
  }: CloudLogGapReconcileRequest): Promise<void> {
    const { rawEntries } = await this.fetchSessionLogs(logUrl, taskRunId, {
      minEntryCount: expectedCount,
    });
    const session = sessionStoreSetters.getSessions()[taskRunId];
    if (!session || session.taskId !== taskId) {
      return;
    }

    const latestCount = session.processedLineCount ?? 0;
    if (latestCount >= expectedCount) {
      return;
    }

    if (rawEntries.length >= expectedCount) {
      const events = convertStoredEntriesToEvents(rawEntries);
      if (hasSessionPromptEvent(events)) {
        sessionStoreSetters.clearTailOptimisticItems(taskRunId);
      }
      sessionStoreSetters.updateSession(taskRunId, {
        events,
        isCloud: true,
        logUrl: logUrl ?? session.logUrl,
        processedLineCount: rawEntries.length,
      });
      this.updatePromptStateFromEvents(taskRunId, events);
      return;
    }

    log.warn("Cloud task log count inconsistency", {
      taskRunId,
      currentCount,
      expectedCount,
      entriesReceived: newEntries.length,
    });
    let newEvents = convertStoredEntriesToEvents(newEntries);
    newEvents = this.filterSkippedPromptEvents(taskRunId, session, newEvents);
    if (hasSessionPromptEvent(newEvents)) {
      sessionStoreSetters.clearTailOptimisticItems(taskRunId);
    }
    sessionStoreSetters.appendEvents(
      taskRunId,
      newEvents,
      latestCount + newEntries.length,
    );
    this.updatePromptStateFromEvents(taskRunId, newEvents);
  }

  private createBaseSession(
    taskRunId: string,
    taskId: string,
    taskTitle: string,
  ): AgentSession {
    return {
      taskRunId,
      taskId,
      taskTitle,
      channel: `agent-event:${taskRunId}`,
      events: [],
      startedAt: Date.now(),
      status: "connecting",
      isPromptPending: false,
      isCompacting: false,
      promptStartedAt: null,
      pendingPermissions: new Map(),
      pausedDurationMs: 0,
      messageQueue: [],
      optimisticItems: [],
    };
  }

  private getSessionByRunId(taskRunId: string): AgentSession | undefined {
    const sessions = sessionStoreSetters.getSessions();
    return sessions[taskRunId];
  }

  private async appendAndPersist(
    taskId: string,
    session: AgentSession,
    event: AcpMessage,
    storedEntry: StoredLogEntry,
  ): Promise<void> {
    // Don't update processedLineCount - it tracks S3 log lines, not local events
    sessionStoreSetters.appendEvents(session.taskRunId, [event]);

    const client = await getAuthenticatedClient();
    if (client) {
      try {
        await client.appendTaskRunLog(taskId, session.taskRunId, [storedEntry]);
      } catch (error) {
        log.warn("Failed to persist event to logs", { error });
      }
    }
  }
}
