import type {
  Adapter,
  StoredLogEntry,
  Task,
  TaskRun,
} from "@posthog/shared";
import { fetch } from "expo/fetch";
import {
  authedFetch,
  createTimeoutSignal,
  getAccessToken,
  getBaseUrl,
  getProjectId,
  HttpError,
} from "@/lib/api";

export { HttpError } from "@/lib/api";

async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    shouldRetry?: (error: unknown) => boolean;
  } = {},
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 200, shouldRetry } = options;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      const canRetry = shouldRetry ? shouldRetry(error) : true;

      if (isLastAttempt || !canRetry) {
        throw error;
      }

      const delay = baseDelayMs * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Unreachable");
}

function isRetryableError(error: unknown): boolean {
  if (
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status >= 500 && error.status < 600;
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("network")) return true;
    if (message.includes("timeout")) return true;
    if (message.includes("econnreset")) return true;
  }
  return false;
}

export interface RunTaskInCloudOptions {
  branch?: string | null;
  resumeFromRunId?: string;
  pendingUserMessage?: string;
  mode?: "interactive" | "background";
  /** Adapter to use on the cloud runner. Currently only "claude" on mobile. */
  runtimeAdapter?: Adapter;
  /** Gateway model ID, e.g. "claude-opus-4-8". */
  model?: string;
  /** Reasoning effort: "low" | "medium" | "high" (model-dependent). */
  reasoningEffort?: string;
  /** Permission mode: "default" | "acceptEdits" | "plan" | "auto". */
  initialPermissionMode?: string;
  /** Source that triggered this run. */
  runSource?: "manual" | "signal_report";
  /** Signal report ID when run_source is "signal_report". */
  signalReportId?: string;
  /** When true, the cloud run pushes its changes and opens a draft PR on
   *  completion without waiting for an explicit ask. */
  autoPublish?: boolean;
  /** Only false is sent: opts the run out of rtk command-output compression. */
  rtkEnabled?: boolean;
}

export async function runTaskInCloud(
  taskId: string,
  options?: RunTaskInCloudOptions,
): Promise<Task> {
  const baseUrl = getBaseUrl();
  const projectId = getProjectId();

  // Only serialize a body when we have options to send. Sending an empty
  // or minimal body on the initial run historically changed backend
  // behavior, so we preserve the "no body" path for the common case.
  const hasOptions =
    !!options &&
    (options.branch !== undefined ||
      options.resumeFromRunId !== undefined ||
      options.pendingUserMessage !== undefined ||
      options.mode !== undefined ||
      options.runtimeAdapter !== undefined ||
      options.model !== undefined ||
      options.reasoningEffort !== undefined ||
      options.initialPermissionMode !== undefined ||
      options.runSource !== undefined ||
      options.signalReportId !== undefined ||
      options.autoPublish !== undefined ||
      options.rtkEnabled === false);

  let body: string | undefined;
  if (hasOptions) {
    const payload: Record<string, unknown> = {
      mode: options?.mode ?? "interactive",
    };
    if (options?.branch) payload.branch = options.branch;
    if (options?.resumeFromRunId) {
      payload.resume_from_run_id = options.resumeFromRunId;
    }
    if (options?.pendingUserMessage) {
      payload.pending_user_message = options.pendingUserMessage;
    }
    if (options?.runtimeAdapter) {
      payload.runtime_adapter = options.runtimeAdapter;
      if (options?.model) payload.model = options.model;
      if (options?.reasoningEffort) {
        payload.reasoning_effort = options.reasoningEffort;
      }
    }
    if (options?.initialPermissionMode) {
      payload.initial_permission_mode = options.initialPermissionMode;
    }
    if (options?.runSource) payload.run_source = options.runSource;
    if (options?.signalReportId)
      payload.signal_report_id = options.signalReportId;
    if (options?.autoPublish !== undefined) {
      payload.auto_publish = options.autoPublish;
    }
    if (options?.rtkEnabled === false) {
      payload.rtk_enabled = false;
    }
    body = JSON.stringify(payload);
  }

  const response = await authedFetch(
    `${baseUrl}/api/projects/${projectId}/tasks/${taskId}/run/`,
    {
      method: "POST",
      body,
    },
  );

  if (!response.ok) {
    throw new HttpError(
      response.status,
      response.statusText,
      "Failed to run task",
    );
  }

  return await response.json();
}

export async function getTaskRun(
  taskId: string,
  runId: string,
): Promise<TaskRun> {
  const baseUrl = getBaseUrl();
  const projectId = getProjectId();

  const response = await authedFetch(
    `${baseUrl}/api/projects/${projectId}/tasks/${taskId}/runs/${runId}/`,
  );

  if (!response.ok) {
    throw new HttpError(
      response.status,
      response.statusText,
      "Failed to fetch task run",
    );
  }

  return await response.json();
}

export async function cancelRun(
  taskId: string,
  runId: string,
  reason?: string,
): Promise<{ status?: string }> {
  const baseUrl = getBaseUrl();
  const projectId = getProjectId();

  const response = await authedFetch(
    `${baseUrl}/api/projects/${projectId}/tasks/${taskId}/runs/${runId}/cancel/`,
    {
      method: "POST",
      body: JSON.stringify(reason ? { reason } : {}),
    },
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: unknown;
    } | null;
    const message =
      typeof payload?.error === "string" && payload.error
        ? payload.error
        : "Failed to stop run";
    throw new HttpError(response.status, response.statusText, message);
  }

  return (await response.json().catch(() => ({}))) as { status?: string };
}

export async function appendTaskRunLog(
  taskId: string,
  runId: string,
  entries: StoredLogEntry[],
): Promise<void> {
  return withRetry(
    async () => {
      const baseUrl = getBaseUrl();
      const projectId = getProjectId();

      const response = await authedFetch(
        `${baseUrl}/api/projects/${projectId}/tasks/${taskId}/runs/${runId}/append_log/`,
        {
          method: "POST",
          body: JSON.stringify({ entries }),
        },
      );

      if (!response.ok) {
        throw new HttpError(
          response.status,
          response.statusText,
          "Failed to append log",
        );
      }
    },
    { shouldRetry: isRetryableError },
  );
}

/**
 * Structured error thrown by `sendCloudCommand`. Exposes the HTTP status and
 * the backend error payload so callers can branch on specific failure modes
 * (e.g. "No active sandbox for this task run" → trigger a resume flow).
 */
export class CloudCommandError extends Error {
  readonly status: number;
  readonly backendError: string | null;
  readonly method: string;

  constructor(
    method: string,
    status: number,
    backendError: string | null,
    message: string,
  ) {
    super(message);
    this.name = "CloudCommandError";
    this.method = method;
    this.status = status;
    this.backendError = backendError;
  }

  /** True when the cloud sandbox for this run has terminated. */
  isSandboxInactive(): boolean {
    return (
      !!this.backendError?.includes("No active sandbox") ||
      !!this.backendError?.includes("returned 404") ||
      this.status === 404
    );
  }
}

/**
 * Sends a JSON-RPC command to a running cloud task. This is the correct path
 * for delivering follow-up user prompts to the agent — it gets translated into
 * `session/prompt` on the agent side. Note: `appendTaskRunLog` only writes to
 * S3 for display; it does NOT notify the agent.
 */
export async function sendCloudCommand(
  taskId: string,
  runId: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const baseUrl = getBaseUrl();
  const projectId = getProjectId();

  const body = {
    jsonrpc: "2.0",
    method,
    params,
    id: `posthog-mobile-${Date.now()}`,
  };

  const response = await authedFetch(
    `${baseUrl}/api/projects/${projectId}/tasks/${taskId}/runs/${runId}/command/`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let backendError: string | null = null;
    try {
      const parsed = JSON.parse(text);
      backendError =
        typeof parsed?.error === "string"
          ? parsed.error
          : (parsed?.error?.message ?? null);
    } catch {
      backendError = text || null;
    }
    throw new CloudCommandError(
      method,
      response.status,
      backendError,
      `Cloud command '${method}' failed: ${response.status} ${response.statusText} ${text}`,
    );
  }

  const data = await response.json();
  if (data?.error) {
    const message =
      typeof data.error === "string"
        ? data.error
        : (data.error.message ?? JSON.stringify(data.error));
    throw new CloudCommandError(
      method,
      200,
      message,
      `Cloud command '${method}' error: ${message}`,
    );
  }
  return data?.result;
}

export interface SessionLogsPage {
  entries: StoredLogEntry[];
  hasMore: boolean;
}

export async function fetchSessionLogs(
  taskId: string,
  runId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<SessionLogsPage> {
  return withRetry(
    async () => {
      const baseUrl = getBaseUrl();
      const projectId = getProjectId();

      const params = new URLSearchParams({
        limit: String(options.limit ?? 5000),
        offset: String(options.offset ?? 0),
      });

      const response = await authedFetch(
        `${baseUrl}/api/projects/${projectId}/tasks/${taskId}/runs/${runId}/session_logs/?${params}`,
        { signal: createTimeoutSignal(10_000) },
      );

      if (!response.ok) {
        throw new HttpError(
          response.status,
          response.statusText,
          "Failed to fetch session logs",
        );
      }

      const entries = (await response.json()) as StoredLogEntry[];
      return {
        entries,
        hasMore: response.headers.get("X-Has-More") === "true",
      };
    },
    { shouldRetry: isRetryableError },
  );
}

export interface StreamCloudTaskOptions {
  lastEventId?: string | null;
  startLatest?: boolean;
  signal: AbortSignal;
}

export async function streamCloudTask(
  taskId: string,
  runId: string,
  options: StreamCloudTaskOptions,
): Promise<Response> {
  const baseUrl = getBaseUrl();
  const projectId = getProjectId();
  const accessToken = getAccessToken();

  const url = new URL(
    `${baseUrl}/api/projects/${projectId}/tasks/${taskId}/runs/${runId}/stream/`,
  );
  if (options.startLatest && !options.lastEventId) {
    url.searchParams.set("start", "latest");
  }

  const headers: Record<string, string> = {
    Accept: "text/event-stream",
    Authorization: `Bearer ${accessToken}`,
  };
  if (options.lastEventId) {
    headers["Last-Event-ID"] = options.lastEventId;
  }

  return await fetch(url.toString(), {
    method: "GET",
    headers,
    signal: options.signal,
  });
}
