import {
  ROOT_LOGGER,
  type RootLogger,
  type ScopedLogger,
} from "@posthog/di/logger";
import {
  ANALYTICS_SERVICE,
  type IAnalytics,
} from "@posthog/platform/analytics";
import type { StoredLogEntry } from "@posthog/shared";
import { serializeError, TypedEventEmitter } from "@posthog/shared";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { inject, injectable, preDestroy } from "inversify";
import type { CloudTaskPermissionRequestUpdate } from "./cloud-task-types";
import { CLOUD_TASK_AUTH, type ICloudTaskAuth } from "./identifiers";
import {
  CloudTaskEvent,
  type CloudTaskEvents,
  isTerminalStatus,
  type SendCommandInput,
  type SendCommandOutput,
  type TaskRunStatus,
  type WatchInput,
} from "./schemas";
import { type SseEvent, SseEventParser } from "./sse-parser";

// Reconnect backoff: flat base delay for the first SSE_RECONNECT_FLAT_ATTEMPTS attempts, then
// exponential up to the cap (0.5, 0.5, 0.5, 1, 2, 4, 8, 16, 30s), spanning ~60s before giving up.
const MAX_SSE_RECONNECT_ATTEMPTS = 9;
const MAX_CUMULATIVE_RECONNECT_ATTEMPTS = 30;
const SSE_RECONNECT_BASE_DELAY_MS = 500;
const SSE_RECONNECT_FLAT_ATTEMPTS = 3;
const SSE_RECONNECT_MAX_DELAY_MS = 30_000;
const SSE_HEALTHY_CONNECTION_MS = 60_000;
const EVENT_BATCH_FLUSH_MS = 16;
const EVENT_BATCH_MAX_SIZE = 50;
const SESSION_LOG_PAGE_LIMIT = 5_000;

// Authoritative end-of-stream sentinel. The client stops on it without consulting run status.
const STREAM_END_EVENT_NAME = "stream-end";

interface SessionLogsPage {
  entries: StoredLogEntry[];
  hasMore: boolean;
}

interface CloudTaskConnectionError {
  title: string;
  message: string;
  retryable: boolean;
  autoRetry?: boolean;
}

class CloudTaskStreamError extends Error {
  constructor(
    message: string,
    public readonly details: CloudTaskConnectionError,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "CloudTaskStreamError";
  }
}

class BackendStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendStreamError";
  }
}

interface TaskRunResponse {
  id: string;
  status: TaskRunStatus;
  stage?: string | null;
  output?: Record<string, unknown> | null;
  error_message?: string | null;
  branch?: string | null;
  updated_at?: string;
  completed_at?: string | null;
}

interface TaskRunStateEvent {
  type: "task_run_state";
  status?: TaskRunStatus;
  stage?: string | null;
  output?: Record<string, unknown> | null;
  error_message?: string | null;
  branch?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
}

// Which endpoint a connection reads from. Event ids are only meaningful within their issuing leg.
type StreamLeg = "proxy" | "django";

interface WatcherState {
  taskId: string;
  runId: string;
  apiHost: string;
  teamId: number;
  subscriberCount: number;
  sseAbortController: AbortController | null;
  reconnectTimeoutId: ReturnType<typeof setTimeout> | null;
  batchFlushTimeoutId: ReturnType<typeof setTimeout> | null;
  pendingLogEntries: StoredLogEntry[];
  totalEntryCount: number;
  /** On resume the renderer already holds the prior conversation; start live-
   *  only (no bootstrap fetch/snapshot) seeded at this count so the in-flight
   *  turn can't collide with a re-fetched snapshot. Null on non-resume watches. */
  resumeFromEntryCount: number | null;
  reconnectAttempts: number;
  streamErrorAttempts: number;
  cumulativeReconnectAttempts: number;
  lastEventId: string | null;
  // Leg that issued lastEventId, and the leg of the connection currently being read.
  lastEventIdLeg: StreamLeg | null;
  streamLeg: StreamLeg | null;
  lastStatus: TaskRunStatus | null;
  lastStage: string | null;
  lastOutput: Record<string, unknown> | null;
  lastErrorMessage: string | null;
  lastBranch: string | null;
  lastStatusUpdatedAt: string | null;
  connStartedAt: number;
  connSentLastEventId: string | null;
  connDataEventsReceived: number;
  isBootstrapping: boolean;
  hasEmittedSnapshot: boolean;
  bufferedLogBatches: StoredLogEntry[][];
  emittedLogEntries: StoredLogEntry[];
  failed: boolean;
  needsPostBootstrapReconnect: boolean;
  needsStopAfterBootstrap: boolean;
  streamEnded: boolean;
  // Consumes one automatic re-bootstrap recovery; re-armed by a data event or healthy connection.
  selfHealAttempted: boolean;
  // streamBaseUrl set => read via the agent-proxy with streamReadToken; null => read from Django.
  streamTargetResolved: boolean;
  streamBaseUrl: string | null;
  streamReadToken: string | null;
  // True once stream_token resolved. False for old servers (404), which fall back to status polling.
  durableStreamEnabled: boolean;
}

function watcherKey(taskId: string, runId: string): string {
  return `${taskId}:${runId}`;
}

function isTaskRunStateEvent(data: unknown): data is TaskRunStateEvent {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: string }).type === "task_run_state"
  );
}

interface SseErrorEventData {
  error: string;
}

function isSseErrorEvent(data: unknown): data is SseErrorEventData {
  return (
    typeof data === "object" &&
    data !== null &&
    "error" in data &&
    typeof (data as SseErrorEventData).error === "string"
  );
}

interface PermissionRequestEventData {
  type: "permission_request";
  requestId: string;
  toolCall: CloudTaskPermissionRequestUpdate["toolCall"];
  options: CloudTaskPermissionRequestUpdate["options"];
}

function isPermissionRequestEvent(
  data: unknown,
): data is PermissionRequestEventData {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: string }).type === "permission_request" &&
    typeof (data as { requestId?: string }).requestId === "string"
  );
}

function isKeepaliveEvent(event: SseEvent): boolean {
  return (
    event.event === "keepalive" ||
    (typeof event.data === "object" &&
      event.data !== null &&
      "type" in event.data &&
      event.data.type === "keepalive")
  );
}

function createStreamStatusError(status: number): CloudTaskStreamError {
  switch (status) {
    case 401:
      return new CloudTaskStreamError(
        "Cloud authentication expired",
        {
          title: "Cloud authentication expired",
          message: "Please reauthenticate and retry the cloud run stream.",
          retryable: true,
          autoRetry: false,
        },
        status,
      );
    case 403:
      return new CloudTaskStreamError(
        "Cloud access denied",
        {
          title: "Cloud access denied",
          message:
            "You no longer have access to this cloud run. Reauthenticate and retry.",
          retryable: true,
          autoRetry: false,
        },
        status,
      );
    case 404:
      return new CloudTaskStreamError(
        "Cloud run not found",
        {
          title: "Cloud run not found",
          message:
            "This cloud run could not be found. It may have been deleted or moved.",
          retryable: false,
          autoRetry: false,
        },
        status,
      );
    case 406:
      return new CloudTaskStreamError(
        "Cloud stream unavailable",
        {
          title: "Cloud stream unavailable",
          message:
            "The backend rejected the live stream request. Restart the backend and retry.",
          retryable: true,
          autoRetry: false,
        },
        status,
      );
    default:
      return new CloudTaskStreamError(
        `Stream request failed with status ${status}`,
        {
          title: "Cloud stream failed",
          message: `The cloud stream request failed with status ${status}. Retry to reconnect.`,
          retryable: true,
          autoRetry: true,
        },
        status,
      );
  }
}

function shouldFailWatcherForFetchStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 404;
}

// 5xx and 429 are momentary: the stream-token endpoint exists but is briefly unavailable, so the
// target stays unresolved and the next reconnect retries instead of caching a Django fallback.
function isTransientStreamTargetStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

@injectable()
export class CloudTaskService extends TypedEventEmitter<CloudTaskEvents> {
  private watchers = new Map<string, WatcherState>();
  private readonly log: ScopedLogger;

  constructor(
    @inject(CLOUD_TASK_AUTH)
    private readonly auth: ICloudTaskAuth,
    @inject(ANALYTICS_SERVICE)
    private readonly analytics: IAnalytics,
    @inject(ROOT_LOGGER)
    logger: RootLogger,
  ) {
    super();
    this.log = logger.scope("cloud-task");
  }

  watch(input: WatchInput): void {
    const key = watcherKey(input.taskId, input.runId);

    const existing = this.watchers.get(key);
    if (existing) {
      existing.subscriberCount++;
      this.log.info("Cloud task watcher subscriber added", {
        key,
        subscribers: existing.subscriberCount,
      });
      void this.emitCurrentSnapshot(key);
      return;
    }

    this.startWatcher(input, 1);
  }

  unwatch(taskId: string, runId: string): void {
    const key = watcherKey(taskId, runId);
    const watcher = this.watchers.get(key);
    if (!watcher) {
      return;
    }

    watcher.subscriberCount--;
    if (watcher.subscriberCount <= 0) {
      this.stopWatcher(key);
    } else {
      this.log.info("Cloud task watcher subscriber removed", {
        key,
        subscribers: watcher.subscriberCount,
      });
    }
  }

  retry(taskId: string, runId: string): void {
    const key = watcherKey(taskId, runId);
    const watcher = this.watchers.get(key);
    if (!watcher) return;

    if (watcher.reconnectTimeoutId) {
      clearTimeout(watcher.reconnectTimeoutId);
      watcher.reconnectTimeoutId = null;
    }

    watcher.sseAbortController?.abort();
    watcher.sseAbortController = null;

    if (watcher.batchFlushTimeoutId) {
      clearTimeout(watcher.batchFlushTimeoutId);
      watcher.batchFlushTimeoutId = null;
    }

    this.log.info("Retrying cloud task watcher", {
      key,
      hasSnapshot: watcher.hasEmittedSnapshot,
    });

    // Start over from scratch: a poisoned resume position loops straight back into the same
    // failure, so re-bootstrap to re-resolve the read leg and emit a fresh snapshot.
    this.resetWatcherForRebootstrap(watcher);
    void this.bootstrapWatcher(key);
  }

  // Resets a watcher to its pre-bootstrap state so bootstrapWatcher can rebuild it from server truth.
  private resetWatcherForRebootstrap(watcher: WatcherState): void {
    watcher.reconnectAttempts = 0;
    watcher.streamErrorAttempts = 0;
    watcher.cumulativeReconnectAttempts = 0;
    watcher.failed = false;
    watcher.pendingLogEntries = [];
    watcher.bufferedLogBatches = [];
    watcher.needsPostBootstrapReconnect = false;
    watcher.needsStopAfterBootstrap = false;
    watcher.streamEnded = false;
    watcher.selfHealAttempted = false;
    watcher.lastEventId = null;
    watcher.lastEventIdLeg = null;
    watcher.streamLeg = null;
    watcher.totalEntryCount = 0;
    watcher.isBootstrapping = false;
    watcher.streamTargetResolved = false;
    watcher.streamBaseUrl = null;
    watcher.streamReadToken = null;
    watcher.durableStreamEnabled = false;
  }

  async sendCommand(input: SendCommandInput): Promise<SendCommandOutput> {
    const url = `${input.apiHost}/api/projects/${input.teamId}/tasks/${input.taskId}/runs/${input.runId}/command/`;
    const body = {
      jsonrpc: "2.0",
      method: input.method,
      params: input.params ?? {},
      id: `posthog-code-${Date.now()}`,
    };

    try {
      const response = await this.auth.authenticatedFetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        let errorMessage = `Command failed with status ${response.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error?.message) {
            errorMessage = errorJson.error.message;
          } else if (errorJson.error) {
            errorMessage =
              typeof errorJson.error === "string"
                ? errorJson.error
                : JSON.stringify(errorJson.error);
          }
        } catch {
          if (errorText) errorMessage = errorText;
        }

        this.log.warn("Cloud task command failed", {
          taskId: input.taskId,
          runId: input.runId,
          method: input.method,
          status: response.status,
          error: errorMessage,
        });
        return { success: false, error: errorMessage };
      }

      const data = (await response.json()) as {
        error?: { message?: string };
        result?: unknown;
      };

      if (data.error) {
        this.log.warn("Cloud task command returned error", {
          taskId: input.taskId,
          method: input.method,
          error: data.error,
        });
        return {
          success: false,
          error: data.error.message ?? JSON.stringify(data.error),
        };
      }

      this.log.info("Cloud task command sent", {
        taskId: input.taskId,
        runId: input.runId,
        method: input.method,
      });

      return { success: true, result: data.result };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.log.error("Cloud task command error", {
        taskId: input.taskId,
        method: input.method,
        error: errorMessage,
      });
      return { success: false, error: errorMessage };
    }
  }

  @preDestroy()
  unwatchAll(): void {
    for (const key of [...this.watchers.keys()]) {
      this.stopWatcher(key);
    }
  }

  private startWatcher(input: WatchInput, subscriberCount: number): void {
    const key = watcherKey(input.taskId, input.runId);

    const watcher: WatcherState = {
      taskId: input.taskId,
      runId: input.runId,
      apiHost: input.apiHost,
      teamId: input.teamId,
      subscriberCount,
      sseAbortController: null,
      reconnectTimeoutId: null,
      batchFlushTimeoutId: null,
      pendingLogEntries: [],
      totalEntryCount: 0,
      resumeFromEntryCount: input.resumeFromEntryCount ?? null,
      reconnectAttempts: 0,
      streamErrorAttempts: 0,
      cumulativeReconnectAttempts: 0,
      lastEventId: null,
      lastEventIdLeg: null,
      streamLeg: null,
      lastStatus: null,
      lastStage: null,
      lastOutput: null,
      lastErrorMessage: null,
      lastBranch: null,
      lastStatusUpdatedAt: null,
      connStartedAt: 0,
      connSentLastEventId: null,
      connDataEventsReceived: 0,
      isBootstrapping: false,
      hasEmittedSnapshot: false,
      bufferedLogBatches: [],
      emittedLogEntries: [],
      failed: false,
      needsPostBootstrapReconnect: false,
      needsStopAfterBootstrap: false,
      streamEnded: false,
      selfHealAttempted: false,
      streamTargetResolved: false,
      streamBaseUrl: null,
      streamReadToken: null,
      durableStreamEnabled: false,
    };

    this.watchers.set(key, watcher);
    this.log.info("Cloud task watcher started", { key });
    void this.bootstrapWatcher(key);
  }

  private stopWatcher(key: string): void {
    const watcher = this.watchers.get(key);
    if (!watcher) return;

    watcher.sseAbortController?.abort();

    if (watcher.reconnectTimeoutId) {
      clearTimeout(watcher.reconnectTimeoutId);
      watcher.reconnectTimeoutId = null;
    }

    if (watcher.batchFlushTimeoutId) {
      clearTimeout(watcher.batchFlushTimeoutId);
      watcher.batchFlushTimeoutId = null;
    }

    this.flushLogBatch(key);
    this.watchers.delete(key);
    this.log.info("Cloud task watcher stopped", { key });
  }

  private async bootstrapWatcher(key: string): Promise<void> {
    const watcher = this.watchers.get(key);
    if (!watcher) return;

    watcher.failed = false;
    watcher.needsPostBootstrapReconnect = false;
    watcher.needsStopAfterBootstrap = false;

    const run = await this.fetchTaskRun(watcher);
    const currentWatcher = this.watchers.get(key);
    if (!currentWatcher || currentWatcher !== watcher) return;
    if (watcher.failed) return;

    if (!run) {
      this.failWatcher(key, {
        title: "Failed to load cloud run",
        message: "Could not fetch the cloud run state. Retry to reconnect.",
        retryable: true,
      });
      return;
    }

    this.applyTaskRunState(watcher, run);

    if (
      !isTerminalStatus(run.status) &&
      watcher.resumeFromEntryCount !== null
    ) {
      watcher.totalEntryCount = watcher.resumeFromEntryCount;
      watcher.hasEmittedSnapshot = true;
      watcher.isBootstrapping = false;
      void this.connectSse(key, { startLatest: true });
      return;
    }

    if (isTerminalStatus(run.status)) {
      const historicalEntries = await this.fetchAllSessionLogs(watcher);
      const terminalWatcher = this.watchers.get(key);
      if (!terminalWatcher || terminalWatcher !== watcher) return;
      if (watcher.failed) return;
      if (!historicalEntries) {
        this.failWatcher(key, {
          title: "Failed to load task history",
          message:
            "Could not load the persisted cloud task logs. Retry to reconnect.",
          retryable: true,
        });
        return;
      }

      watcher.totalEntryCount = historicalEntries.length;
      watcher.hasEmittedSnapshot = true;
      this.emit(CloudTaskEvent.Update, {
        taskId: watcher.taskId,
        runId: watcher.runId,
        kind: "snapshot",
        newEntries: historicalEntries,
        totalEntryCount: watcher.totalEntryCount,
        status: watcher.lastStatus ?? undefined,
        stage: watcher.lastStage,
        output: watcher.lastOutput,
        errorMessage: watcher.lastErrorMessage,
        branch: watcher.lastBranch,
      });
      this.stopWatcher(key);
      return;
    }

    watcher.isBootstrapping = true;
    watcher.bufferedLogBatches = [];
    void this.connectSse(key, { startLatest: true });

    const historicalEntries = await this.fetchAllSessionLogs(watcher);
    const bootstrappingWatcher = this.watchers.get(key);
    if (!bootstrappingWatcher || bootstrappingWatcher !== watcher) return;
    if (watcher.failed) return;
    if (!historicalEntries) {
      this.failWatcher(key, {
        title: "Failed to load cloud run history",
        message:
          "Could not load the existing cloud run logs. Retry to reconnect.",
        retryable: true,
      });
      return;
    }

    // Flush any pending live entries into the bootstrap buffer before snapshot.
    this.flushLogBatch(key);

    watcher.totalEntryCount = historicalEntries.length;
    watcher.hasEmittedSnapshot = true;

    this.emit(CloudTaskEvent.Update, {
      taskId: watcher.taskId,
      runId: watcher.runId,
      kind: "snapshot",
      newEntries: historicalEntries,
      totalEntryCount: watcher.totalEntryCount,
      status: watcher.lastStatus ?? undefined,
      stage: watcher.lastStage,
      output: watcher.lastOutput,
      errorMessage: watcher.lastErrorMessage,
      branch: watcher.lastBranch,
    });

    watcher.isBootstrapping = false;
    this.drainBufferedLogBatches(key, historicalEntries);

    if (watcher.failed) {
      return;
    }

    if (watcher.needsStopAfterBootstrap) {
      watcher.needsStopAfterBootstrap = false;
      await this.finalizeWatcherStop(key);
      return;
    }

    if (watcher.needsPostBootstrapReconnect) {
      watcher.needsPostBootstrapReconnect = false;
      this.scheduleReconnect(key, undefined, { countAttempt: false });
    }

    void this.verifyPostBootstrapStatus(key);
  }

  private async verifyPostBootstrapStatus(key: string): Promise<void> {
    const watcher = this.watchers.get(key);
    if (!watcher) return;
    if (isTerminalStatus(watcher.lastStatus)) return;

    const run = await this.fetchTaskRun(watcher);
    const currentWatcher = this.watchers.get(key);
    if (!currentWatcher || currentWatcher !== watcher) return;
    if (!run) return;

    if (!this.applyTaskRunState(watcher, run)) return;
    if (isTerminalStatus(watcher.lastStatus)) return;

    this.emitStatusUpdate(watcher);
  }

  private emitStatusUpdate(watcher: WatcherState): void {
    this.emit(CloudTaskEvent.Update, {
      taskId: watcher.taskId,
      runId: watcher.runId,
      kind: "status",
      status: watcher.lastStatus ?? undefined,
      stage: watcher.lastStage,
      output: watcher.lastOutput,
      errorMessage: watcher.lastErrorMessage,
      branch: watcher.lastBranch,
    });
  }

  private async connectSse(
    key: string,
    options?: { startLatest?: boolean },
  ): Promise<void> {
    const watcher = this.watchers.get(key);
    if (!watcher) return;

    const controller = new AbortController();
    watcher.sseAbortController = controller;

    watcher.connStartedAt = 0;
    watcher.connDataEventsReceived = 0;

    // Resolve the read target once (proxy URL + token, or Django), reused across reconnects.
    if (!watcher.streamTargetResolved) {
      await this.resolveStreamTarget(watcher);
      const resolvedWatcher = this.watchers.get(key);
      if (
        !resolvedWatcher ||
        resolvedWatcher !== watcher ||
        controller.signal.aborted
      ) {
        return;
      }
    }

    const usingProxy = Boolean(
      watcher.streamBaseUrl && watcher.streamReadToken,
    );
    const base = usingProxy
      ? watcher.streamBaseUrl?.replace(/\/+$/, "")
      : watcher.apiHost;
    const leg: StreamLeg = usingProxy ? "proxy" : "django";
    // Proxy and Django id spaces are unrelated, so drop the resume position on a leg switch and
    // let start=latest plus the next snapshot cover the gap.
    if (watcher.lastEventId && watcher.lastEventIdLeg !== leg) {
      this.log.info("Cloud task stream leg changed, dropping resume position", {
        key,
        from: watcher.lastEventIdLeg,
        to: leg,
      });
      watcher.lastEventId = null;
      watcher.lastEventIdLeg = null;
    }
    watcher.streamLeg = leg;

    // Captured after the leg-switch drop so they reflect what this connection actually sends.
    watcher.connSentLastEventId = watcher.lastEventId;
    const startLatest = Boolean(options?.startLatest && !watcher.lastEventId);
    const url = new URL(
      usingProxy
        ? `${base}/v1/runs/${encodeURIComponent(watcher.runId)}/stream`
        : `${base}/api/projects/${watcher.teamId}/tasks/${encodeURIComponent(
            watcher.taskId,
          )}/runs/${encodeURIComponent(watcher.runId)}/stream/`,
    );
    if (startLatest) {
      url.searchParams.set("start", "latest");
    }
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
    };
    if (watcher.lastEventId) {
      headers["Last-Event-ID"] = watcher.lastEventId;
    }
    if (usingProxy) {
      headers.Authorization = `Bearer ${watcher.streamReadToken}`;
    }

    // Debug level: fires on every reconnect and would otherwise dominate the log file.
    this.log.debug("Opening cloud task stream", {
      usingProxy,
      streamUrl: url.toString(),
    });

    const parser = new SseEventParser((message, data) =>
      this.log.warn(message, data),
    );
    const decoder = new TextDecoder();

    // Track how long the body stayed open so healthy long-lived connections cut by churn
    // aren't penalized as failed reconnects (see SSE_HEALTHY_CONNECTION_MS).
    let connectedAt = 0;
    let streamWasEstablished = false;
    let bytesReceived = 0;
    let eventsReceived = 0;

    try {
      // The proxy authenticates with the run-scoped Bearer token; the Django leg uses the session.
      const response = usingProxy
        ? await fetch(url.toString(), {
            method: "GET",
            headers,
            signal: controller.signal,
          })
        : await this.auth.authenticatedFetch(url.toString(), {
            method: "GET",
            headers,
            signal: controller.signal,
          });

      if (!response.ok) {
        throw createStreamStatusError(response.status);
      }

      if (!response.body) {
        throw new Error("Stream response did not include a body");
      }

      connectedAt = Date.now();
      streamWasEstablished = true;
      watcher.connStartedAt = connectedAt;

      this.log.info("Cloud task SSE connected", {
        key,
        sentLastEventId: watcher.connSentLastEventId,
        startLatest,
        status: response.status,
        server: response.headers.get("server"),
        via: response.headers.get("via"),
        cfRay: response.headers.get("cf-ray"),
        cfCacheStatus: response.headers.get("cf-cache-status"),
        xAccelBuffering: response.headers.get("x-accel-buffering"),
        contentType: response.headers.get("content-type"),
        requestId: response.headers.get("x-request-id"),
      });

      const reader = response.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        if (!value) {
          continue;
        }

        bytesReceived += value.byteLength;
        const chunk = decoder.decode(value, { stream: true });
        const events = parser.parse(chunk);
        for (const event of events) {
          eventsReceived += 1;
          this.handleSseEvent(key, event);
        }
      }

      const trailingEvents = parser.parse(decoder.decode());
      for (const event of trailingEvents) {
        this.handleSseEvent(key, event);
      }

      this.flushLogBatch(key);

      if (controller.signal.aborted) {
        return;
      }

      this.log.info("Cloud task stream closed cleanly", {
        key,
        connectionDurationMs: Date.now() - connectedAt,
        bytesReceived,
        eventsReceived,
        dataEventsReceived: watcher.connDataEventsReceived,
        lastEventId: watcher.lastEventId,
      });

      // A long-lived clean close is healthy churn, not a loop: clear the cumulative budget so an
      // idle run can ride out proxy timeout cycles, while instant-EOF loops still exhaust it.
      const completedWatcher = this.watchers.get(key);
      if (
        completedWatcher &&
        streamWasEstablished &&
        Date.now() - connectedAt >= SSE_HEALTHY_CONNECTION_MS
      ) {
        completedWatcher.cumulativeReconnectAttempts = 0;
        completedWatcher.selfHealAttempted = false;
      }

      await this.handleStreamCompletion(key, { reconnectOnDisconnect: true });
    } catch (error) {
      this.flushLogBatch(key);

      if (controller.signal.aborted) {
        return;
      }

      // Proxy-leg 401: the read token expired or its signing key rotated. Re-resolve to mint a
      // fresh token (or route back to Django) instead of failing. Django-leg 401 stays fatal below.
      const unauthorizedWatcher = this.watchers.get(key);
      if (
        error instanceof CloudTaskStreamError &&
        error.status === 401 &&
        unauthorizedWatcher?.streamBaseUrl
      ) {
        unauthorizedWatcher.streamTargetResolved = false;
        unauthorizedWatcher.streamBaseUrl = null;
        unauthorizedWatcher.streamReadToken = null;
        unauthorizedWatcher.durableStreamEnabled = false;
        this.log.info("Cloud task stream proxy token rejected, re-resolving", {
          key,
        });
        await this.handleStreamCompletion(key, {
          reconnectOnDisconnect: true,
          reconnectError: error,
          countReconnectAttempt: true,
        });
        return;
      }

      if (
        error instanceof CloudTaskStreamError &&
        error.details.autoRetry === false
      ) {
        this.failWatcher(key, error.details);
        return;
      }

      const errorMessage =
        error instanceof Error ? error.message : "Unknown stream error";

      const isBackendError = error instanceof BackendStreamError;
      const wasHealthyStream =
        !isBackendError &&
        streamWasEstablished &&
        Date.now() - connectedAt >= SSE_HEALTHY_CONNECTION_MS;

      const watcher = this.watchers.get(key);
      if (watcher) {
        if (isBackendError) {
          watcher.streamErrorAttempts += 1;
        } else if (wasHealthyStream) {
          watcher.streamErrorAttempts = 0;
          // A healthy-length connection proves timeout cycling, not a loop.
          watcher.cumulativeReconnectAttempts = 0;
          watcher.selfHealAttempted = false;
        }
      }

      this.log.warn("Cloud task stream error", {
        key,
        error: errorMessage,
        errorDetail: serializeError(error),
        wasHealthyStream,
        isBackendError,
        streamWasEstablished,
        connectionDurationMs: streamWasEstablished
          ? Date.now() - connectedAt
          : 0,
        bytesReceived,
        eventsReceived,
        dataEventsReceived: watcher?.connDataEventsReceived ?? 0,
        lastEventId: watcher?.lastEventId ?? null,
        reconnectAttempts: watcher?.reconnectAttempts ?? 0,
        streamErrorAttempts: watcher?.streamErrorAttempts ?? 0,
        cumulativeReconnectAttempts: watcher?.cumulativeReconnectAttempts ?? 0,
      });
      await this.handleStreamCompletion(key, {
        reconnectOnDisconnect: true,
        reconnectError: error,
        countReconnectAttempt: !isBackendError && !wasHealthyStream,
      });
    } finally {
      const currentWatcher = this.watchers.get(key);
      if (currentWatcher?.sseAbortController === controller) {
        currentWatcher.sseAbortController = null;
      }
    }
  }

  private handleSseEvent(key: string, event: SseEvent): void {
    const watcher = this.watchers.get(key);
    if (!watcher || watcher.failed) return;

    if (event.id) {
      watcher.lastEventId = event.id;
      watcher.lastEventIdLeg = watcher.streamLeg;
    }

    if (event.event === "error") {
      const message = isSseErrorEvent(event.data)
        ? event.data.error
        : "Unknown stream error";
      throw new BackendStreamError(message);
    }

    if (event.event === STREAM_END_EVENT_NAME) {
      // The run's stream is durably complete. Mark it so completion stops instead
      // of reconnecting, independent of run status. The connection will close
      // naturally (clean EOF) right after this sentinel.
      watcher.streamEnded = true;
      return;
    }

    // A keepalive or real event proves the transport recovered. A keepalive does not clear the
    // backend-error budget, which only a real data event below resets.
    watcher.reconnectAttempts = 0;

    if (isKeepaliveEvent(event)) {
      return;
    }

    // A real data event proves the stream materialized; clear the remaining budgets and re-arm self-heal.
    watcher.streamErrorAttempts = 0;
    watcher.cumulativeReconnectAttempts = 0;
    watcher.selfHealAttempted = false;

    watcher.connDataEventsReceived += 1;
    if (watcher.connDataEventsReceived === 1 && watcher.connSentLastEventId) {
      this.log.info("Cloud task SSE resumed", {
        key,
        resumedFrom: watcher.connSentLastEventId,
        firstEventIdAfterResume: event.id ?? null,
      });
    }

    if (isTaskRunStateEvent(event.data)) {
      if (this.applyTaskRunState(watcher, event.data)) {
        if (!watcher.isBootstrapping && !isTerminalStatus(watcher.lastStatus)) {
          this.emit(CloudTaskEvent.Update, {
            taskId: watcher.taskId,
            runId: watcher.runId,
            kind: "status",
            status: watcher.lastStatus ?? undefined,
            stage: watcher.lastStage,
            output: watcher.lastOutput,
            errorMessage: watcher.lastErrorMessage,
            branch: watcher.lastBranch,
          });
        }
      }
      return;
    }

    if (isPermissionRequestEvent(event.data)) {
      this.emit(CloudTaskEvent.Update, {
        taskId: watcher.taskId,
        runId: watcher.runId,
        kind: "permission_request" as const,
        requestId: event.data.requestId,
        toolCall: event.data.toolCall,
        options: event.data.options,
      });
      return;
    }

    watcher.pendingLogEntries.push(event.data as StoredLogEntry);
    if (watcher.pendingLogEntries.length >= EVENT_BATCH_MAX_SIZE) {
      this.flushLogBatch(key);
      return;
    }

    if (!watcher.batchFlushTimeoutId) {
      watcher.batchFlushTimeoutId = setTimeout(() => {
        watcher.batchFlushTimeoutId = null;
        this.flushLogBatch(key);
      }, EVENT_BATCH_FLUSH_MS);
    }
  }

  private flushLogBatch(key: string): void {
    const watcher = this.watchers.get(key);
    if (!watcher || watcher.pendingLogEntries.length === 0) return;

    if (watcher.batchFlushTimeoutId) {
      clearTimeout(watcher.batchFlushTimeoutId);
      watcher.batchFlushTimeoutId = null;
    }

    const entries = watcher.pendingLogEntries;
    watcher.pendingLogEntries = [];

    if (watcher.isBootstrapping) {
      watcher.bufferedLogBatches.push(entries);
      return;
    }

    watcher.totalEntryCount += entries.length;
    this.rememberEmittedLogEntries(watcher, entries);

    this.emit(CloudTaskEvent.Update, {
      taskId: watcher.taskId,
      runId: watcher.runId,
      kind: "logs",
      newEntries: entries,
      totalEntryCount: watcher.totalEntryCount,
    });
  }

  private drainBufferedLogBatches(
    key: string,
    historicalEntries: StoredLogEntry[],
  ): void {
    const watcher = this.watchers.get(key);
    if (!watcher || watcher.bufferedLogBatches.length === 0) return;

    // Content-based dedup: SSE ids don't exist in the historical entries, so the payload is the key.
    const historicalCounts = new Map<string, number>();
    for (const entry of historicalEntries) {
      const serialized = JSON.stringify(entry);
      historicalCounts.set(
        serialized,
        (historicalCounts.get(serialized) ?? 0) + 1,
      );
    }

    for (const entries of watcher.bufferedLogBatches) {
      const dedupedEntries = entries.filter((entry) => {
        const serialized = JSON.stringify(entry);
        const remaining = historicalCounts.get(serialized) ?? 0;
        if (remaining <= 0) {
          return true;
        }

        historicalCounts.set(serialized, remaining - 1);
        return false;
      });

      if (dedupedEntries.length === 0) {
        continue;
      }

      watcher.totalEntryCount += dedupedEntries.length;
      this.rememberEmittedLogEntries(watcher, dedupedEntries);
      this.emit(CloudTaskEvent.Update, {
        taskId: watcher.taskId,
        runId: watcher.runId,
        kind: "logs",
        newEntries: dedupedEntries,
        totalEntryCount: watcher.totalEntryCount,
      });
    }

    watcher.bufferedLogBatches = [];
  }

  private rememberEmittedLogEntries(
    watcher: WatcherState,
    entries: StoredLogEntry[],
  ): void {
    watcher.emittedLogEntries.push(...entries);
  }

  private mergeHistoricalAndEmittedEntries(
    historicalEntries: StoredLogEntry[],
    emittedEntries: StoredLogEntry[],
  ): {
    snapshotEntries: StoredLogEntry[];
    missingEmittedEntries: StoredLogEntry[];
  } {
    if (emittedEntries.length === 0) {
      return { snapshotEntries: historicalEntries, missingEmittedEntries: [] };
    }

    const historicalCounts = new Map<string, number>();
    for (const entry of historicalEntries) {
      const serialized = JSON.stringify(entry);
      historicalCounts.set(
        serialized,
        (historicalCounts.get(serialized) ?? 0) + 1,
      );
    }

    const missingEmittedEntries = emittedEntries.filter((entry) => {
      const serialized = JSON.stringify(entry);
      const remaining = historicalCounts.get(serialized) ?? 0;
      if (remaining <= 0) {
        return true;
      }

      historicalCounts.set(serialized, remaining - 1);
      return false;
    });

    return {
      snapshotEntries: [...historicalEntries, ...missingEmittedEntries],
      missingEmittedEntries,
    };
  }

  private async emitCurrentSnapshot(key: string): Promise<void> {
    const watcher = this.watchers.get(key);
    if (!watcher || watcher.failed) return;

    const historicalEntries = await this.fetchAllSessionLogs(watcher);
    const currentWatcher = this.watchers.get(key);
    if (!currentWatcher || currentWatcher !== watcher || watcher.failed) {
      return;
    }

    if (!historicalEntries) {
      this.log.warn("Cloud task snapshot replay failed", {
        taskId: watcher.taskId,
        runId: watcher.runId,
      });
      return;
    }

    const { snapshotEntries, missingEmittedEntries } =
      this.mergeHistoricalAndEmittedEntries(
        historicalEntries,
        watcher.emittedLogEntries,
      );
    watcher.emittedLogEntries = missingEmittedEntries;
    if (snapshotEntries.length > watcher.totalEntryCount) {
      watcher.totalEntryCount = snapshotEntries.length;
    }

    this.emit(CloudTaskEvent.Update, {
      taskId: watcher.taskId,
      runId: watcher.runId,
      kind: "snapshot",
      newEntries: snapshotEntries,
      totalEntryCount: snapshotEntries.length,
      status: watcher.lastStatus ?? undefined,
      stage: watcher.lastStage,
      output: watcher.lastOutput,
      errorMessage: watcher.lastErrorMessage,
      branch: watcher.lastBranch,
    });
  }

  private failWatcher(key: string, error: CloudTaskConnectionError): void {
    const watcher = this.watchers.get(key);
    if (!watcher) return;

    this.log.warn("Cloud task watcher failed", {
      key,
      errorTitle: error.title,
      retryable: error.retryable,
      status: watcher.lastStatus,
      wasBootstrapping: watcher.isBootstrapping,
      reconnectAttempts: watcher.reconnectAttempts,
      cumulativeReconnectAttempts: watcher.cumulativeReconnectAttempts,
      totalEntryCount: watcher.totalEntryCount,
      lastEventId: watcher.lastEventId,
    });

    this.analytics.track(ANALYTICS_EVENTS.CLOUD_STREAM_DISCONNECTED, {
      task_id: watcher.taskId,
      run_id: watcher.runId,
      team_id: watcher.teamId,
      error_title: error.title,
      retryable: error.retryable,
      reconnect_attempts: watcher.reconnectAttempts,
      stream_error_attempts: watcher.streamErrorAttempts,
      cumulative_reconnect_attempts: watcher.cumulativeReconnectAttempts,
      was_bootstrapping: watcher.isBootstrapping,
    });

    watcher.failed = true;
    watcher.isBootstrapping = false;
    watcher.pendingLogEntries = [];
    watcher.bufferedLogBatches = [];

    if (watcher.reconnectTimeoutId) {
      clearTimeout(watcher.reconnectTimeoutId);
      watcher.reconnectTimeoutId = null;
    }

    if (watcher.batchFlushTimeoutId) {
      clearTimeout(watcher.batchFlushTimeoutId);
      watcher.batchFlushTimeoutId = null;
    }

    watcher.sseAbortController?.abort();
    watcher.sseAbortController = null;

    this.emit(CloudTaskEvent.Update, {
      taskId: watcher.taskId,
      runId: watcher.runId,
      kind: "error",
      errorTitle: error.title,
      errorMessage: error.message,
      retryable: error.retryable,
    });
  }

  private scheduleReconnect(
    key: string,
    error?: unknown,
    options: { countAttempt?: boolean } = {},
  ): void {
    const watcher = this.watchers.get(key);
    // Status-unaware: the loop only stops on the stream-end sentinel or budget exhaustion below.
    if (!watcher || watcher.failed) {
      return;
    }

    if (watcher.reconnectTimeoutId) {
      clearTimeout(watcher.reconnectTimeoutId);
    }

    // Bounds runaway loops that clean-EOF (countAttempt=false) and dodge reconnectAttempts.
    watcher.cumulativeReconnectAttempts += 1;
    const countAttempt = options.countAttempt ?? true;
    if (countAttempt) {
      watcher.reconnectAttempts += 1;
    }

    if (
      watcher.cumulativeReconnectAttempts > MAX_CUMULATIVE_RECONNECT_ATTEMPTS
    ) {
      // A poisoned resume position burns the budget without an error frame. Rebuild once from
      // scratch (the app-restart recovery) before failing; if it loops straight back, fail for real.
      if (!watcher.selfHealAttempted) {
        watcher.reconnectTimeoutId = null;
        this.log.warn(
          "Cloud task stream looping without events, re-bootstrapping",
          { key },
        );
        this.resetWatcherForRebootstrap(watcher);
        watcher.selfHealAttempted = true;
        void this.bootstrapWatcher(key);
        return;
      }
      this.failWatcher(key, {
        title: "Cloud run unreachable",
        message:
          "Could not maintain a connection to the cloud run after many attempts. Click retry once the issue is resolved.",
        retryable: true,
      });
      return;
    }

    // Fail once either budget (transport reconnect or backend stream-error) is exhausted.
    const attemptCount = Math.max(
      watcher.reconnectAttempts,
      watcher.streamErrorAttempts,
    );
    if (attemptCount > MAX_SSE_RECONNECT_ATTEMPTS) {
      const details =
        error instanceof CloudTaskStreamError
          ? error.details
          : {
              title: "Cloud stream disconnected",
              message:
                "Lost connection to the cloud run stream. Retry to reconnect.",
              retryable: true,
            };
      this.failWatcher(key, details);
      return;
    }

    const backoffAttempts =
      error instanceof BackendStreamError
        ? watcher.streamErrorAttempts
        : watcher.reconnectAttempts;
    const delay = Math.min(
      SSE_RECONNECT_BASE_DELAY_MS *
        2 ** Math.max(backoffAttempts - SSE_RECONNECT_FLAT_ATTEMPTS, 0),
      SSE_RECONNECT_MAX_DELAY_MS,
    );

    watcher.reconnectTimeoutId = setTimeout(() => {
      const currentWatcher = this.watchers.get(key);
      if (!currentWatcher) return;
      currentWatcher.reconnectTimeoutId = null;
      void this.connectSse(key, {
        startLatest:
          currentWatcher.isBootstrapping || currentWatcher.hasEmittedSnapshot,
      });
    }, delay);
  }

  private async handleStreamCompletion(
    key: string,
    options: {
      reconnectOnDisconnect: boolean;
      reconnectError?: unknown;
      countReconnectAttempt?: boolean;
    },
  ): Promise<void> {
    const watcher = this.watchers.get(key);
    if (!watcher) return;
    if (watcher.failed) return;

    const { reconnectOnDisconnect } = options;

    // Bootstrap owns the snapshot lifecycle: stopping mid-bootstrap would discard the backlog and
    // buffered live entries. Record intent and let bootstrap finish.
    if (watcher.isBootstrapping) {
      if (watcher.streamEnded || !reconnectOnDisconnect) {
        watcher.needsStopAfterBootstrap = true;
      } else {
        watcher.needsPostBootstrapReconnect = true;
      }
      return;
    }

    // The stream-end sentinel is the only signal that ends a durable watch. Any disconnect without
    // it is transport churn to reconnect through; status is tracked for display only, never to stop.
    if (watcher.streamEnded) {
      await this.finalizeWatcherStop(key);
      return;
    }

    // Legacy mode (old server): no sentinel, so poll run status on disconnect to decide stop vs
    // reconnect. The reconnect budgets keep the new semantics, so self-heal stays active here too.
    if (!watcher.durableStreamEnabled && reconnectOnDisconnect) {
      const run = await this.fetchTaskRun(watcher);
      const legacyWatcher = this.watchers.get(key);
      if (!legacyWatcher || legacyWatcher !== watcher) return;
      if (watcher.failed) return;

      if (run) {
        this.applyTaskRunState(watcher, run);
      }
      if (isTerminalStatus(watcher.lastStatus)) {
        this.emitStatusUpdate(watcher);
        this.stopWatcher(key);
        return;
      }
      if (run) {
        this.emitStatusUpdate(watcher);
      }
      this.scheduleReconnect(key, options.reconnectError, {
        countAttempt: options.countReconnectAttempt ?? false,
      });
      return;
    }

    if (reconnectOnDisconnect) {
      this.scheduleReconnect(key, options.reconnectError, {
        countAttempt: options.countReconnectAttempt ?? false,
      });
      return;
    }

    this.log.info("Cloud task terminal stop", {
      key,
      status: watcher.lastStatus,
      reachedViaError: options.reconnectError !== undefined,
      lastEventId: watcher.lastEventId,
      sentLastEventId: watcher.connSentLastEventId,
      totalEntryCount: watcher.totalEntryCount,
      connDataEventsReceived: watcher.connDataEventsReceived,
      connDurationMs:
        watcher.connStartedAt !== 0 ? Date.now() - watcher.connStartedAt : 0,
    });

    await this.finalizeWatcherStop(key);
  }

  // Stops a watcher whose stream is durably complete. Repairs the displayed status if the stream
  // ended non-terminal (dropped final frame); the poll never decides whether to stop.
  private async finalizeWatcherStop(key: string): Promise<void> {
    const watcher = this.watchers.get(key);
    if (!watcher) return;

    if (!isTerminalStatus(watcher.lastStatus)) {
      const run = await this.fetchTaskRun(watcher);
      const currentWatcher = this.watchers.get(key);
      if (!currentWatcher || currentWatcher !== watcher) return;
      if (run) {
        this.applyTaskRunState(watcher, run);
      }
    }

    this.emitStatusUpdate(watcher);
    this.stopWatcher(key);
  }

  private applyTaskRunState(
    watcher: WatcherState,
    run:
      | Pick<
          TaskRunResponse,
          | "status"
          | "stage"
          | "output"
          | "error_message"
          | "branch"
          | "updated_at"
        >
      | TaskRunStateEvent,
  ): boolean {
    const updatedAt = run.updated_at ?? null;
    if (
      updatedAt &&
      watcher.lastStatusUpdatedAt &&
      Date.parse(updatedAt) <= Date.parse(watcher.lastStatusUpdatedAt)
    ) {
      return false;
    }

    const nextStatus = run.status ?? watcher.lastStatus;
    const nextStage = run.stage ?? null;
    const nextOutput = run.output ?? null;
    const nextErrorMessage = run.error_message ?? null;
    const nextBranch = run.branch ?? null;

    const changed =
      nextStatus !== watcher.lastStatus ||
      nextStage !== watcher.lastStage ||
      JSON.stringify(nextOutput) !== JSON.stringify(watcher.lastOutput) ||
      nextErrorMessage !== watcher.lastErrorMessage ||
      nextBranch !== watcher.lastBranch;

    watcher.lastStatus = nextStatus ?? null;
    watcher.lastStage = nextStage;
    watcher.lastOutput = nextOutput;
    watcher.lastErrorMessage = nextErrorMessage;
    watcher.lastBranch = nextBranch;
    if (updatedAt) {
      watcher.lastStatusUpdatedAt = updatedAt;
    }

    return changed;
  }

  private async fetchSessionLogsPage(
    watcher: WatcherState,
    offset: number,
  ): Promise<SessionLogsPage | null> {
    const url = new URL(
      `${watcher.apiHost}/api/projects/${watcher.teamId}/tasks/${watcher.taskId}/runs/${watcher.runId}/session_logs/`,
    );
    url.searchParams.set("limit", SESSION_LOG_PAGE_LIMIT.toString());
    url.searchParams.set("offset", offset.toString());

    try {
      const authedResponse = await this.auth.authenticatedFetch(
        url.toString(),
        {
          method: "GET",
        },
      );

      if (!authedResponse.ok) {
        this.log.warn("Cloud task session logs fetch failed", {
          status: authedResponse.status,
          taskId: watcher.taskId,
          runId: watcher.runId,
          offset,
        });
        if (shouldFailWatcherForFetchStatus(authedResponse.status)) {
          this.failWatcher(
            watcherKey(watcher.taskId, watcher.runId),
            createStreamStatusError(authedResponse.status).details,
          );
        }
        return null;
      }

      const raw = await authedResponse.text();
      return {
        entries: JSON.parse(raw) as StoredLogEntry[],
        hasMore: authedResponse.headers.get("X-Has-More") === "true",
      };
    } catch (error) {
      this.log.warn("Cloud task session logs fetch error", {
        taskId: watcher.taskId,
        runId: watcher.runId,
        offset,
        error,
      });
      return null;
    }
  }

  private async fetchAllSessionLogs(
    watcher: WatcherState,
  ): Promise<StoredLogEntry[] | null> {
    const entries: StoredLogEntry[] = [];
    let offset = 0;

    while (true) {
      const page = await this.fetchSessionLogsPage(watcher, offset);
      if (!page) {
        return null;
      }

      for (const entry of page.entries) {
        entries.push(entry);
      }
      if (!page.hasMore || page.entries.length === 0) {
        return entries;
      }

      offset += page.entries.length;
    }
  }

  private async resolveStreamTarget(watcher: WatcherState): Promise<void> {
    const url = `${watcher.apiHost}/api/projects/${watcher.teamId}/tasks/${watcher.taskId}/runs/${watcher.runId}/stream_token/`;
    try {
      const response = await this.auth.authenticatedFetch(url, {
        method: "GET",
      });
      if (!response.ok) {
        watcher.streamBaseUrl = null;
        watcher.streamReadToken = null;
        if (isTransientStreamTargetStatus(response.status)) {
          // Transient: read from Django this round but leave the target unresolved so the next
          // reconnect retries durable resolution instead of pinning the run to status polling.
          this.log.warn("Cloud task stream target temporarily unavailable", {
            taskId: watcher.taskId,
            runId: watcher.runId,
            status: response.status,
          });
          return;
        }
        // Refused, or an old server without the endpoint: read from Django with status polling.
        watcher.durableStreamEnabled = false;
        watcher.streamTargetResolved = true;
        this.log.info("Cloud task stream reading from API host", {
          taskId: watcher.taskId,
          runId: watcher.runId,
          status: response.status,
        });
        return;
      }
      const data = (await response.json()) as {
        token?: string;
        stream_base_url?: string | null;
      };
      watcher.streamReadToken = data.token ?? null;
      watcher.streamBaseUrl = data.stream_base_url ?? null;
      // The endpoint resolving at all opts this watcher into the status-unaware contract;
      // old servers 404 above and stay on legacy status polling.
      watcher.durableStreamEnabled = true;
      watcher.streamTargetResolved = true;
      this.log.info("Cloud task stream target resolved", {
        taskId: watcher.taskId,
        runId: watcher.runId,
        streamBaseUrl: watcher.streamBaseUrl,
        hasToken: Boolean(watcher.streamReadToken),
        durableStream: watcher.durableStreamEnabled,
      });
    } catch (error) {
      // Transient failure: leave unresolved so the next reconnect retries and falls back to Django.
      watcher.streamBaseUrl = null;
      watcher.streamReadToken = null;
      this.log.warn("Cloud task stream target resolution failed", {
        taskId: watcher.taskId,
        runId: watcher.runId,
        error,
      });
    }
  }

  private async fetchTaskRun(
    watcher: WatcherState,
  ): Promise<TaskRunResponse | null> {
    const url = `${watcher.apiHost}/api/projects/${watcher.teamId}/tasks/${watcher.taskId}/runs/${watcher.runId}/`;

    try {
      const authedResponse = await this.auth.authenticatedFetch(url, {
        method: "GET",
      });

      if (!authedResponse.ok) {
        this.log.warn("Cloud task status fetch failed", {
          status: authedResponse.status,
          taskId: watcher.taskId,
          runId: watcher.runId,
        });
        if (shouldFailWatcherForFetchStatus(authedResponse.status)) {
          this.failWatcher(
            watcherKey(watcher.taskId, watcher.runId),
            createStreamStatusError(authedResponse.status).details,
          );
        }
        return null;
      }

      return (await authedResponse.json()) as TaskRunResponse;
    } catch (error) {
      this.log.warn("Cloud task status fetch error", {
        taskId: watcher.taskId,
        runId: watcher.runId,
        error,
      });
      return null;
    }
  }
}
