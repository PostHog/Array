import { fetch } from "expo/fetch";
import { getBaseUrl, getHeaders, getProjectId } from "@/lib/api";
import { logger } from "@/lib/logger";
import type {
  CreateTaskOptions,
  Integration,
  StoredLogEntry,
  Task,
  TaskRun,
} from "./types";

const log = logger.scope("tasks-api");

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, statusText: string, prefix: string) {
    super(`${prefix}: ${status} ${statusText}`);
    this.name = "HttpError";
    this.status = status;
  }
}

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

export async function getTasks(filters?: {
  repository?: string;
  createdBy?: number;
}): Promise<Task[]> {
  const baseUrl = getBaseUrl();
  const projectId = getProjectId();
  const headers = getHeaders();

  const params = new URLSearchParams({ limit: "500" });
  if (filters?.repository) {
    params.set("repository", filters.repository);
  }
  if (filters?.createdBy) {
    params.set("created_by", String(filters.createdBy));
  }

  const response = await fetch(
    `${baseUrl}/api/projects/${projectId}/tasks/?${params}`,
    { headers },
  );

  if (!response.ok) {
    throw new HttpError(
      response.status,
      response.statusText,
      "Failed to fetch tasks",
    );
  }

  const data = await response.json();
  return data.results ?? [];
}

export async function getTask(taskId: string): Promise<Task> {
  const baseUrl = getBaseUrl();
  const projectId = getProjectId();
  const headers = getHeaders();

  const response = await fetch(
    `${baseUrl}/api/projects/${projectId}/tasks/${taskId}/`,
    { headers },
  );

  if (!response.ok) {
    throw new HttpError(
      response.status,
      response.statusText,
      "Failed to fetch task",
    );
  }

  return await response.json();
}

export async function createTask(options: CreateTaskOptions): Promise<Task> {
  const baseUrl = getBaseUrl();
  const projectId = getProjectId();
  const headers = getHeaders();

  const response = await fetch(`${baseUrl}/api/projects/${projectId}/tasks/`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      origin_product: "user_created",
      ...options,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    log.error("Create task error", errorText);
    throw new HttpError(
      response.status,
      `${response.statusText} - ${errorText}`,
      "Failed to create task",
    );
  }

  return await response.json();
}

export async function updateTask(
  taskId: string,
  updates: Partial<Task>,
): Promise<Task> {
  const baseUrl = getBaseUrl();
  const projectId = getProjectId();
  const headers = getHeaders();

  const response = await fetch(
    `${baseUrl}/api/projects/${projectId}/tasks/${taskId}/`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify(updates),
    },
  );

  if (!response.ok) {
    throw new HttpError(
      response.status,
      response.statusText,
      "Failed to update task",
    );
  }

  return await response.json();
}

export async function deleteTask(taskId: string): Promise<void> {
  const baseUrl = getBaseUrl();
  const projectId = getProjectId();
  const headers = getHeaders();

  const response = await fetch(
    `${baseUrl}/api/projects/${projectId}/tasks/${taskId}/`,
    {
      method: "DELETE",
      headers,
    },
  );

  if (!response.ok) {
    throw new HttpError(
      response.status,
      response.statusText,
      "Failed to delete task",
    );
  }
}

export interface RunTaskInCloudOptions {
  branch?: string | null;
  resumeFromRunId?: string;
  pendingUserMessage?: string;
  mode?: "interactive" | "background";
}

export async function runTaskInCloud(
  taskId: string,
  options?: RunTaskInCloudOptions,
): Promise<Task> {
  const baseUrl = getBaseUrl();
  const projectId = getProjectId();
  const headers = getHeaders();

  // Only serialize a body when we have options to send. Sending an empty
  // or minimal body on the initial run historically changed backend
  // behavior, so we preserve the "no body" path for the common case.
  const hasOptions =
    !!options &&
    (options.branch !== undefined ||
      options.resumeFromRunId !== undefined ||
      options.pendingUserMessage !== undefined ||
      options.mode !== undefined);

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
    body = JSON.stringify(payload);
  }

  const response = await fetch(
    `${baseUrl}/api/projects/${projectId}/tasks/${taskId}/run/`,
    {
      method: "POST",
      headers,
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
  const headers = getHeaders();

  const response = await fetch(
    `${baseUrl}/api/projects/${projectId}/tasks/${taskId}/runs/${runId}/`,
    { headers },
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

export async function appendTaskRunLog(
  taskId: string,
  runId: string,
  entries: StoredLogEntry[],
): Promise<void> {
  return withRetry(
    async () => {
      const baseUrl = getBaseUrl();
      const projectId = getProjectId();
      const headers = getHeaders();

      const response = await fetch(
        `${baseUrl}/api/projects/${projectId}/tasks/${taskId}/runs/${runId}/append_log/`,
        {
          method: "POST",
          headers,
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
  const headers = getHeaders();

  const body = {
    jsonrpc: "2.0",
    method,
    params,
    id: `posthog-mobile-${Date.now()}`,
  };

  const response = await fetch(
    `${baseUrl}/api/projects/${projectId}/tasks/${taskId}/runs/${runId}/command/`,
    {
      method: "POST",
      headers,
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

export async function fetchS3Logs(logUrl: string): Promise<string> {
  return withRetry(
    async () => {
      const response = await fetch(logUrl, {
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        if (response.status === 404) {
          return "";
        }
        throw new HttpError(
          response.status,
          response.statusText,
          "Failed to fetch logs",
        );
      }

      return await response.text();
    },
    { shouldRetry: isRetryableError },
  );
}

export async function getIntegrations(): Promise<Integration[]> {
  const baseUrl = getBaseUrl();
  const projectId = getProjectId();
  const headers = getHeaders();

  const response = await fetch(
    `${baseUrl}/api/environments/${projectId}/integrations/`,
    { headers },
  );

  if (!response.ok) {
    throw new HttpError(
      response.status,
      response.statusText,
      "Failed to fetch integrations",
    );
  }

  const data = await response.json();
  return data.results ?? data ?? [];
}

const GITHUB_REPOS_PAGE_SIZE = 500;

export async function getGithubRepositories(
  integrationId: number,
): Promise<string[]> {
  const baseUrl = getBaseUrl();
  const projectId = getProjectId();
  const headers = getHeaders();

  const allRepos: string[] = [];
  let offset = 0;

  while (true) {
    const params = new URLSearchParams({
      limit: String(GITHUB_REPOS_PAGE_SIZE),
      offset: String(offset),
    });
    const response = await fetch(
      `${baseUrl}/api/environments/${projectId}/integrations/${integrationId}/github_repos/?${params}`,
      { headers },
    );

    if (!response.ok) {
      throw new HttpError(
        response.status,
        response.statusText,
        "Failed to fetch repositories",
      );
    }

    const data = await response.json();
    const repos: Array<string | { full_name?: string; name?: string }> =
      data.repositories ?? data.results ?? data ?? [];

    const normalized = repos
      .map((repo) => {
        if (typeof repo === "string") return repo.toLowerCase();
        return (repo.full_name ?? repo.name ?? "").toLowerCase();
      })
      .filter((name) => name.length > 0);

    allRepos.push(...normalized);

    if (!data.has_more || repos.length === 0) {
      return allRepos;
    }

    offset += repos.length;
  }
}
