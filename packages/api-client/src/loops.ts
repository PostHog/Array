// Hand-written client surface for the Loops API
// (`/api/projects/{project_id}/loops/`), mirroring the shape typed-openapi
// emits in `generated.ts` (a `Schemas`-style namespace of response/request
// types plus per-endpoint request functions). Loops routes are not yet in
// the OpenAPI schema this client is generated from, so this module fills the
// gap by hand; once `apps/code/scripts/update-openapi-client.ts` includes
// `/api/projects/{project_id}/loops` and is rerun against a live posthog
// instance, `Schemas.Loop` and friends land in `generated.ts` and this file
// can be deleted in favor of the generated equivalents.
import type { ApiClient, Method } from "./generated";

export namespace LoopSchemas {
  export type LoopVisibilityEnum = "personal" | "team";
  export type LoopOverlapPolicyEnum = "skip" | "allow" | "cancel_previous";
  export type LoopTriggerTypeEnum = "schedule" | "github" | "api";
  export type LoopScheduleSyncStatusEnum = "pending" | "synced" | "failed";
  export type LoopRuntimeAdapterEnum = "claude" | "codex";
  export type LoopReasoningEffortEnum =
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | "max";
  export type LoopPosthogMcpScopesEnum = "read_only" | "full";
  export type LoopNotificationEventEnum =
    | "run_completed"
    | "run_failed"
    | "pr_created"
    | "needs_attention";
  export type LoopGithubTriggerEventEnum =
    | "issues"
    | "issue_comment"
    | "pull_request"
    | "push";
  export type LoopFireReasonEnum =
    | "created"
    | "deduped"
    | "overlap_skipped"
    | "rate_capped"
    | "disabled"
    | "gate_blocked";
  export type LoopRunStatusEnum =
    | "not_started"
    | "queued"
    | "in_progress"
    | "completed"
    | "failed"
    | "cancelled";
  export type LoopRunEnvironmentEnum = "local" | "cloud";

  export type LoopRepositoryEntry = {
    github_integration_id: number;
    full_name: string;
  };

  export type LoopBehaviors = {
    create_prs: boolean;
    watch_ci: boolean;
    fix_review_comments: boolean;
    max_fix_iterations: number;
  };

  export type LoopBehaviorsWrite = Partial<LoopBehaviors>;

  export type LoopConnectors = {
    mcp_installation_ids: Array<string>;
    posthog_mcp_scopes: LoopPosthogMcpScopesEnum;
  };

  export type LoopConnectorsWrite = Partial<LoopConnectors>;

  export type LoopNotificationChannel = {
    enabled: boolean;
    events: Array<LoopNotificationEventEnum>;
    params: Record<string, unknown>;
  };

  export type LoopNotificationChannelWrite = Partial<LoopNotificationChannel>;

  export type LoopNotifications = {
    push: LoopNotificationChannel;
    email: LoopNotificationChannel;
    slack: LoopNotificationChannel;
  };

  export type LoopNotificationsWrite = Partial<{
    push: LoopNotificationChannelWrite;
    email: LoopNotificationChannelWrite;
    slack: LoopNotificationChannelWrite;
  }>;

  export type LoopScheduleTriggerConfig = {
    cron_expression?: string;
    timezone?: string;
    run_at?: string;
  };

  export type LoopGithubTriggerFilters = {
    actions?: Array<string>;
    branches?: Array<string>;
    labels?: Array<string>;
  };

  export type LoopGithubTriggerConfig = {
    github_integration_id: number;
    repository: string;
    events: Array<LoopGithubTriggerEventEnum>;
    filters?: LoopGithubTriggerFilters;
  };

  export type LoopApiTriggerConfig = Record<string, never>;

  export type LoopTriggerConfig =
    | LoopScheduleTriggerConfig
    | LoopGithubTriggerConfig
    | LoopApiTriggerConfig;

  export type LoopTrigger = {
    id: string;
    loop_id: string;
    type: LoopTriggerTypeEnum;
    enabled: boolean;
    config: LoopTriggerConfig;
    schedule_sync_status: LoopScheduleSyncStatusEnum | null;
    last_fired_at: string | null;
    created_at: string;
    updated_at: string;
  };

  /** Full desired trigger list is id-stable: entries with a matching `id` are
   * updated in place, entries without one are created, and existing triggers
   * absent from the list on a write are deleted. */
  export type LoopTriggerWrite = {
    id?: string;
    type: LoopTriggerTypeEnum;
    enabled?: boolean;
    config?: LoopTriggerConfig;
  };

  export type Loop = {
    id: string;
    team_id: number;
    created_by_id: number | null;
    name: string;
    description: string;
    visibility: LoopVisibilityEnum;
    instructions: string;
    runtime_adapter: LoopRuntimeAdapterEnum;
    model: string;
    reasoning_effort: LoopReasoningEffortEnum | null;
    repositories: Array<LoopRepositoryEntry>;
    sandbox_environment_id: string | null;
    enabled: boolean;
    overlap_policy: LoopOverlapPolicyEnum;
    behaviors: LoopBehaviors;
    connectors: LoopConnectors;
    notifications: LoopNotifications;
    last_run_at: string | null;
    last_run_status: string | null;
    last_error: string | null;
    consecutive_failures: number;
    created_at: string;
    updated_at: string;
    triggers: Array<LoopTrigger>;
  };

  /** Request body for create (all required fields present) and partial_update
   * (see `PatchedLoop`) — the backend uses one serializer for both, toggling
   * `partial`. `sandbox_environment` takes an id; the read side returns it as
   * `sandbox_environment_id`. */
  export type LoopWrite = {
    name: string;
    description?: string;
    visibility?: LoopVisibilityEnum;
    instructions: string;
    runtime_adapter: LoopRuntimeAdapterEnum;
    model: string;
    reasoning_effort?: LoopReasoningEffortEnum | null;
    repositories?: Array<LoopRepositoryEntry>;
    sandbox_environment?: string | null;
    enabled?: boolean;
    overlap_policy?: LoopOverlapPolicyEnum;
    behaviors?: LoopBehaviorsWrite;
    connectors?: LoopConnectorsWrite;
    notifications?: LoopNotificationsWrite;
    triggers?: Array<LoopTriggerWrite>;
  };

  export type PatchedLoop = Partial<LoopWrite>;

  export type PaginatedLoopList = {
    count: number;
    next: string | null;
    previous: string | null;
    results: Array<Loop>;
  };

  export type LoopRun = {
    id: string;
    task_id: string;
    loop_trigger_id: string | null;
    status: LoopRunStatusEnum;
    environment: LoopRunEnvironmentEnum;
    branch: string | null;
    error_message: string | null;
    output: Record<string, unknown> | null;
    created_at: string;
    completed_at: string | null;
  };

  export type LoopRunPage = {
    results: Array<LoopRun>;
    next_cursor: string | null;
  };

  export type LoopFireRun = {
    created: boolean;
    reason: LoopFireReasonEnum;
    task_id: string | null;
    task_run_id: string | null;
  };

  export type LoopPreviewRequest = {
    trigger_type?: LoopTriggerTypeEnum;
    payload?: unknown;
  };

  export type LoopPreview = {
    instructions: string;
    trigger_type: string;
    trigger_context: string;
  };
}

export namespace LoopEndpoints {
  export type get_Loops_list = {
    method: "GET";
    path: "/api/projects/{project_id}/loops/";
    requestFormat: "json";
    parameters: {
      query?: Partial<{ limit: number; offset: number }>;
      path: { project_id: string };
    };
    responses: { 200: LoopSchemas.PaginatedLoopList };
  };
  export type post_Loops_create = {
    method: "POST";
    path: "/api/projects/{project_id}/loops/";
    requestFormat: "json";
    parameters: {
      path: { project_id: string };
      body: LoopSchemas.LoopWrite;
    };
    responses: { 201: LoopSchemas.Loop };
  };
  export type get_Loops_retrieve = {
    method: "GET";
    path: "/api/projects/{project_id}/loops/{id}/";
    requestFormat: "json";
    parameters: {
      path: { id: string; project_id: string };
    };
    responses: { 200: LoopSchemas.Loop };
  };
  export type patch_Loops_partial_update = {
    method: "PATCH";
    path: "/api/projects/{project_id}/loops/{id}/";
    requestFormat: "json";
    parameters: {
      path: { id: string; project_id: string };
      body: LoopSchemas.PatchedLoop;
    };
    responses: { 200: LoopSchemas.Loop };
  };
  export type delete_Loops_destroy = {
    method: "DELETE";
    path: "/api/projects/{project_id}/loops/{id}/";
    requestFormat: "json";
    parameters: {
      path: { id: string; project_id: string };
    };
    responses: { 204: unknown };
  };
  export type post_Loops_run_create = {
    method: "POST";
    path: "/api/projects/{project_id}/loops/{id}/run/";
    requestFormat: "json";
    parameters: {
      path: { id: string; project_id: string };
      header?: { "Idempotency-Key"?: string };
    };
    responses: { 200: LoopSchemas.LoopFireRun };
  };
  export type post_Loops_trigger_create = {
    method: "POST";
    path: "/api/projects/{project_id}/loops/{id}/trigger/";
    requestFormat: "json";
    parameters: {
      path: { id: string; project_id: string };
      header?: { "Idempotency-Key"?: string };
      body: Record<string, unknown>;
    };
    responses: { 200: LoopSchemas.LoopFireRun };
  };
  export type get_Loops_runs_list = {
    method: "GET";
    path: "/api/projects/{project_id}/loops/{id}/runs/";
    requestFormat: "json";
    parameters: {
      query?: Partial<{ cursor: string; limit: number }>;
      path: { id: string; project_id: string };
    };
    responses: { 200: LoopSchemas.LoopRunPage };
  };
  export type post_Loops_preview_create = {
    method: "POST";
    path: "/api/projects/{project_id}/loops/{id}/preview/";
    requestFormat: "json";
    parameters: {
      path: { id: string; project_id: string };
      body?: LoopSchemas.LoopPreviewRequest;
    };
    responses: { 200: LoopSchemas.LoopPreview };
  };
}

const loopsListPath = (projectId: string): string =>
  `/api/projects/${projectId}/loops/`;
const loopDetailPath = (projectId: string, loopId: string): string =>
  `/api/projects/${projectId}/loops/${loopId}/`;
const loopRunPath = (projectId: string, loopId: string): string =>
  `/api/projects/${projectId}/loops/${loopId}/run/`;
const loopTriggerPath = (projectId: string, loopId: string): string =>
  `/api/projects/${projectId}/loops/${loopId}/trigger/`;
const loopRunsPath = (projectId: string, loopId: string): string =>
  `/api/projects/${projectId}/loops/${loopId}/runs/`;
const loopPreviewPath = (projectId: string, loopId: string): string =>
  `/api/projects/${projectId}/loops/${loopId}/preview/`;

function idempotencyHeader(
  idempotencyKey: string | undefined,
): Record<string, string> | undefined {
  return idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined;
}

async function loopsRequest<T>(
  client: ApiClient,
  method: Method,
  path: string,
  options?: {
    query?: Record<string, unknown>;
    body?: unknown;
    header?: Record<string, unknown>;
  },
): Promise<T> {
  const encodeSearchParams =
    client.fetcher.encodeSearchParams ?? client.defaultEncodeSearchParams;
  const parseResponseData =
    client.fetcher.parseResponseData ?? client.defaultParseResponseData;

  const response = await client.fetcher.fetch({
    method,
    path,
    url: new URL(client.baseUrl + path),
    urlSearchParams: encodeSearchParams(options?.query),
    parameters: { body: options?.body, header: options?.header },
  });

  if (!response.ok) {
    throw new Error(
      `Loops API request failed: ${method.toUpperCase()} ${path} [${response.status}]`,
    );
  }

  return (await parseResponseData(response)) as T;
}

export async function listLoops(
  client: ApiClient,
  projectId: string,
  query?: LoopEndpoints.get_Loops_list["parameters"]["query"],
): Promise<LoopSchemas.PaginatedLoopList> {
  return loopsRequest(client, "get", loopsListPath(projectId), { query });
}

export async function retrieveLoop(
  client: ApiClient,
  projectId: string,
  loopId: string,
): Promise<LoopSchemas.Loop> {
  return loopsRequest(client, "get", loopDetailPath(projectId, loopId));
}

export async function createLoop(
  client: ApiClient,
  projectId: string,
  body: LoopSchemas.LoopWrite,
): Promise<LoopSchemas.Loop> {
  return loopsRequest(client, "post", loopsListPath(projectId), { body });
}

export async function partialUpdateLoop(
  client: ApiClient,
  projectId: string,
  loopId: string,
  body: LoopSchemas.PatchedLoop,
): Promise<LoopSchemas.Loop> {
  return loopsRequest(client, "patch", loopDetailPath(projectId, loopId), {
    body,
  });
}

export async function destroyLoop(
  client: ApiClient,
  projectId: string,
  loopId: string,
): Promise<void> {
  await loopsRequest(client, "delete", loopDetailPath(projectId, loopId));
}

export async function runLoop(
  client: ApiClient,
  projectId: string,
  loopId: string,
  idempotencyKey?: string,
): Promise<LoopSchemas.LoopFireRun> {
  return loopsRequest(client, "post", loopRunPath(projectId, loopId), {
    header: idempotencyHeader(idempotencyKey),
  });
}

export async function triggerLoop(
  client: ApiClient,
  projectId: string,
  loopId: string,
  payload: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<LoopSchemas.LoopFireRun> {
  return loopsRequest(client, "post", loopTriggerPath(projectId, loopId), {
    body: payload,
    header: idempotencyHeader(idempotencyKey),
  });
}

export async function listLoopRuns(
  client: ApiClient,
  projectId: string,
  loopId: string,
  query?: LoopEndpoints.get_Loops_runs_list["parameters"]["query"],
): Promise<LoopSchemas.LoopRunPage> {
  return loopsRequest(client, "get", loopRunsPath(projectId, loopId), {
    query,
  });
}

export async function previewLoop(
  client: ApiClient,
  projectId: string,
  loopId: string,
  body?: LoopSchemas.LoopPreviewRequest,
): Promise<LoopSchemas.LoopPreview> {
  return loopsRequest(client, "post", loopPreviewPath(projectId, loopId), {
    body,
  });
}
