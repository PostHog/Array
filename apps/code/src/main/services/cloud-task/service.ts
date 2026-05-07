import type { CloudTaskPermissionRequestUpdate } from "@shared/types";
import type { StoredLogEntry } from "@shared/types/session-events";
import { inject, injectable, preDestroy } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import type { AuthService } from "../auth/service";
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

const log = logger.scope("cloud-task");

const MAX_SSE_RECONNECT_ATTEMPTS = 5;
const SSE_RECONNECT_BASE_DELAY_MS = 2_000;
const SSE_RECONNECT_MAX_DELAY_MS = 30_000;
const EVENT_BATCH_FLUSH_MS = 16;
const EVENT_BATCH_MAX_SIZE = 50;
const SESSION_LOG_PAGE_LIMIT = 5_000;

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
  reconnectAttempts: number;
  lastEventId: string | null;
  lastStatus: TaskRunStatus | null;
  lastStage: string | null;
  lastOutput: Record<string, unknown> | null;
  lastErrorMessage: string | null;
  lastBranch: string | null;
  lastStatusUpdatedAt: string | null;
  isBootstrapping: boolean;
  hasEmittedSnapshot: boolean;
  bufferedLogBatches: StoredLogEntry[][];
  emittedLogEntries: StoredLogEntry[];
  failed: boolean;
  needsPostBootstrapReconnect: boolean;
  needsStopAfterBootstrap: boolean;
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

@injectable()
export class CloudTaskService extends TypedEventEmitter<CloudTaskEvents> {
  private watchers = new Map<string, WatcherState>();

  constructor(
    @inject(MAIN_TOKENS.AuthService)
    private readonly authService: AuthService,
  ) {
    super();
  }

  watch(input: WatchInput): void {
    const key = watcherKey(input.taskId, input.runId);

    const existing = this.watchers.get(key);
    if (existing) {
      existing.subscriberCount++;
      log.info("Cloud task watcher subscriber added", {
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
      log.info("Cloud task watcher subscriber removed", {
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

    watcher.reconnectAttempts = 0;
    watcher.failed = false;
    watcher.pendingLogEntries = [];
    watcher.bufferedLogBatches = [];
    watcher.needsPostBootstrapReconnect = false;
    watcher.needsStopAfterBootstrap = false;

    log.info("Retrying cloud task watcher", {
      key,
      hasSnapshot: watcher.hasEmittedSnapshot,
    });

    if (!watcher.hasEmittedSnapshot) {
      watcher.lastEventId = null;
      watcher.totalEntryCount = 0;
      watcher.isBootstrapping = false;
      void this.bootstrapWatcher(key);
      return;
    }

    void this.connectSse(key, { startLatest: !watcher.lastEventId });
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
      const response = await this.authService.authenticatedFetch(fetch, url, {
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

        log.warn("Cloud task command failed", {
          taskId: input.taskId,
          runId: input.runId,
          method: input.method,
          status: response.status,
          error: errorMessage,
        });
        return { success: false, error: errorMessage };
      }

      const data = await response.json();

      if (data.error) {
        log.warn("Cloud task command returned error", {
          taskId: input.taskId,
          method: input.method,
          error: data.error,
        });
        return {
          success: false,
          error: data.error.message ?? JSON.stringify(data.error),
        };
      }

      log.info("Cloud task command sent", {
        taskId: input.taskId,
        runId: input.runId,
        method: input.method,
      });

      return { success: true, result: data.result };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      log.error("Cloud task command error", {
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
      reconnectAttempts: 0,
      lastEventId: null,
      lastStatus: null,
      lastStage: null,
      lastOutput: null,
      lastErrorMessage: null,
      lastBranch: null,
      lastStatusUpdatedAt: null,
      isBootstrapping: false,
      hasEmittedSnapshot: false,
      bufferedLogBatches: [],
      emittedLogEntries: [],
      failed: false,
      needsPostBootstrapReconnect: false,
      needsStopAfterBootstrap: false,
    };

    this.watchers.set(key, watcher);
    log.info("Cloud task watcher started", { key });
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
    log.info("Cloud task watcher stopped", { key });
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

    if (
      watcher.needsStopAfterBootstrap ||
      isTerminalStatus(watcher.lastStatus)
    ) {
      watcher.needsStopAfterBootstrap = false;
      this.stopWatcher(key);
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

    const url = new URL(
      `${watcher.apiHost}/api/projects/${watcher.teamId}/tasks/${watcher.taskId}/runs/${watcher.runId}/stream/`,
    );
    if (options?.startLatest && !watcher.lastEventId) {
      url.searchParams.set("start", "latest");
    }
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
    };
    if (watcher.lastEventId) {
      headers["Last-Event-ID"] = watcher.lastEventId;
    }

    const parser = new SseEventParser();
    const decoder = new TextDecoder();

    try {
      const response = await this.authService.authenticatedFetch(
        fetch,
        url.toString(),
        {
          method: "GET",
          headers,
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw createStreamStatusError(response.status);
      }

      if (!response.body) {
        throw new Error("Stream response did not include a body");
      }

      const reader = response.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        if (!value) {
          continue;
        }

        const chunk = decoder.decode(value, { stream: true });
        const events = parser.parse(chunk);
        for (const event of events) {
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

      await this.handleStreamCompletion(key, { reconnectIfNonTerminal: true });
    } catch (error) {
      this.flushLogBatch(key);

      if (controller.signal.aborted) {
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
      log.warn("Cloud task stream error", {
        key,
        error: errorMessage,
      });
      await this.handleStreamCompletion(key, {
        reconnectIfNonTerminal: true,
        reconnectError: error,
        countReconnectAttempt: true,
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
    }

    if (event.event === "error") {
      const message = isSseErrorEvent(event.data)
        ? event.data.error
        : "Unknown stream error";
      throw new Error(message);
    }

    if (
      event.event === "keepalive" ||
      (typeof event.data === "object" &&
        event.data !== null &&
        "type" in event.data &&
        event.data.type === "keepalive")
    ) {
      return;
    }

    watcher.reconnectAttempts = 0;

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

    // Content-based dedup because SSE IDs (Redis stream IDs) don't exist in
    // the S3-backed historical entries — the JSON payload is the only shared key
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
      log.warn("Cloud task snapshot replay failed", {
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
    if (!watcher || watcher.failed || isTerminalStatus(watcher.lastStatus)) {
      return;
    }

    if (watcher.reconnectTimeoutId) {
      clearTimeout(watcher.reconnectTimeoutId);
    }

    const countAttempt = options.countAttempt ?? true;
    if (countAttempt) {
      watcher.reconnectAttempts += 1;
    } else {
      watcher.reconnectAttempts = 0;
    }
    if (watcher.reconnectAttempts > MAX_SSE_RECONNECT_ATTEMPTS) {
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

    const delay = Math.min(
      SSE_RECONNECT_BASE_DELAY_MS *
        2 ** Math.max(watcher.reconnectAttempts - 1, 0),
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
      reconnectIfNonTerminal: boolean;
      reconnectError?: unknown;
      countReconnectAttempt?: boolean;
    },
  ): Promise<void> {
    const watcher = this.watchers.get(key);
    if (!watcher) return;

    const { reconnectIfNonTerminal } = options;
    const run = await this.fetchTaskRun(watcher);
    const currentWatcher = this.watchers.get(key);
    if (!currentWatcher || currentWatcher !== watcher) return;
    if (watcher.failed) return;

    if (watcher.isBootstrapping) {
      if (!run) {
        watcher.needsPostBootstrapReconnect = true;
        return;
      }

      this.applyTaskRunState(watcher, run);
      if (isTerminalStatus(watcher.lastStatus) || !reconnectIfNonTerminal) {
        watcher.needsStopAfterBootstrap = true;
      } else {
        watcher.needsPostBootstrapReconnect = true;
      }
      return;
    }

    if (!run) {
      this.scheduleReconnect(
        key,
        new CloudTaskStreamError("Failed to fetch terminal cloud run state", {
          title: "Cloud run state unavailable",
          message:
            "Could not fetch the latest cloud run state after the stream ended. Retry to reconnect.",
          retryable: true,
        }),
      );
      return;
    }

    const stateChanged = this.applyTaskRunState(watcher, run);

    if (!isTerminalStatus(watcher.lastStatus) && reconnectIfNonTerminal) {
      if (stateChanged) {
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
      log.warn("Cloud task stream ended before terminal status", {
        key,
        status: watcher.lastStatus,
      });
      this.scheduleReconnect(key, options.reconnectError, {
        countAttempt: options.countReconnectAttempt ?? false,
      });
      return;
    }

    // Always emit the latest status before stopping. Terminal states are
    // intentionally deferred until stream completion; clean EOFs can also mean
    // the backend has no more stream events even when the run status remains active.
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
      const authedResponse = await this.authService.authenticatedFetch(
        fetch,
        url.toString(),
        {
          method: "GET",
        },
      );

      if (!authedResponse.ok) {
        log.warn("Cloud task session logs fetch failed", {
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
      log.warn("Cloud task session logs fetch error", {
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

  private async fetchTaskRun(
    watcher: WatcherState,
  ): Promise<TaskRunResponse | null> {
    const url = `${watcher.apiHost}/api/projects/${watcher.teamId}/tasks/${watcher.taskId}/runs/${watcher.runId}/`;

    try {
      const authedResponse = await this.authService.authenticatedFetch(
        fetch,
        url,
        {
          method: "GET",
        },
      );

      if (!authedResponse.ok) {
        log.warn("Cloud task status fetch failed", {
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
      log.warn("Cloud task status fetch error", {
        taskId: watcher.taskId,
        runId: watcher.runId,
        error,
      });
      return null;
    }
  }
}
