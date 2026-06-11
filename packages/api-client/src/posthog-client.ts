import "./generated.augment";
import { isSupportedReasoningEffort } from "@posthog/agent/adapters/reasoning-effort";
import type { PermissionMode } from "@posthog/agent/execution-mode";
import type {
  CloudRunSource,
  PrAuthorshipMode,
  SeatData,
  StoredLogEntry,
} from "@posthog/shared";
import {
  DISMISSAL_REASON_OPTIONS,
  type DismissalReasonOptionValue,
  SEAT_PRODUCT_KEY,
} from "@posthog/shared";
import type {
  ActionabilityJudgmentArtefact,
  AvailableSuggestedReviewer,
  AvailableSuggestedReviewersResponse,
  DismissalArtefact,
  PriorityJudgmentArtefact,
  RepoSelectionArtefact,
  SandboxEnvironment,
  SandboxEnvironmentInput,
  Signal,
  SignalFindingArtefact,
  SignalProcessingStateResponse,
  SignalReport,
  SignalReportArtefact,
  SignalReportArtefactsResponse,
  SignalReportSignalsResponse,
  SignalReportsQueryParams,
  SignalReportsResponse,
  SignalReportTask,
  SignalReportTaskRelationship,
  SignalTeamConfig,
  SignalUserAutonomyConfig,
  SlackChannelsQueryParams,
  SlackChannelsResponse,
  SuggestedReviewersArtefact,
  SuggestedReviewerWriteEntry,
  Task,
  TaskRun,
} from "@posthog/shared/domain-types";
import { buildApiFetcher } from "./fetcher";
import { createApiClient, type Schemas } from "./generated";
import type { SpendAnalysisResponse } from "./spend-analysis";
export interface ApiClientLogger {
  warn(...args: unknown[]): void;
}

let log: ApiClientLogger = { warn: () => {} };

export function setPosthogApiClientLogger(logger: ApiClientLogger): void {
  log = logger;
}

// Host build version, set by the host at boot (default "unknown"); avoids a
// build-time global so the package typechecks standalone and across importers.
let clientAppVersion = "unknown";

export function setPosthogApiClientAppVersion(version: string): void {
  clientAppVersion = version;
}

export class SeatSubscriptionRequiredError extends Error {
  redirectUrl: string;
  constructor(redirectUrl: string) {
    super("Billing subscription required");
    this.name = "SeatSubscriptionRequiredError";
    this.redirectUrl = redirectUrl;
  }
}

export class SeatPaymentFailedError extends Error {
  constructor(message?: string) {
    super(message ?? "Payment failed");
    this.name = "SeatPaymentFailedError";
  }
}

export type UsageLimitType = "burst" | "sustained" | null;

// Stable message so callers recognize this after a saga reduces the error to a string.
export const CLOUD_USAGE_LIMIT_ERROR_MESSAGE = "Cloud usage limit reached";

/** Thrown when the backend rejects a cloud run with a 429 usage-limit error. */
export class CloudUsageLimitError extends Error {
  limitType: UsageLimitType;
  resetAt: string | null;
  isPro: boolean;
  constructor(params: {
    limitType: UsageLimitType;
    resetAt: string | null;
    isPro: boolean;
  }) {
    super(CLOUD_USAGE_LIMIT_ERROR_MESSAGE);
    this.name = "CloudUsageLimitError";
    this.limitType = params.limitType;
    this.resetAt = params.resetAt;
    this.isPro = params.isPro;
  }
}

export const MCP_CATEGORIES = [
  { id: "all", label: "All" },
  { id: "business", label: "Business Operations" },
  { id: "data", label: "Data & Analytics" },
  { id: "design", label: "Design & Content" },
  { id: "dev", label: "Developer Tools & APIs" },
  { id: "infra", label: "Infrastructure" },
  { id: "productivity", label: "Productivity & Collaboration" },
] as const;

import type {
  McpApprovalState,
  McpAuthType,
  McpCategory,
  McpInstallationTool,
  McpRecommendedServer,
  McpServerInstallation,
} from "./types";
export type {
  McpApprovalState,
  McpAuthType,
  McpCategory,
  McpInstallationTool,
  McpRecommendedServer,
  McpServerInstallation,
};

export type Evaluation = Schemas.Evaluation;

export interface UserGitHubIntegration {
  id: string;
  kind: "github";
  installation_id: string;
  repository_selection?: string | null;
  account?: {
    type?: string | null;
    name?: string | null;
  } | null;
  uses_shared_installation?: boolean;
  created_at?: string;
}

export interface LlmSkillCreatedBy {
  id?: number;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

export interface LlmSkillFileManifest {
  path: string;
  content_type: string;
}

export interface LlmSkillFile {
  path: string;
  content: string;
  content_type: string;
}

export interface LlmSkillListItem {
  id: string;
  name: string;
  description: string;
  allowed_tools: unknown[];
  metadata: Record<string, unknown>;
  version: number;
  is_latest: boolean;
  latest_version?: number | null;
  version_count?: number | null;
  created_by: LlmSkillCreatedBy | null;
  created_at: string;
  updated_at: string;
}

export interface LlmSkill extends LlmSkillListItem {
  /** The SKILL.md markdown content. */
  body: string;
  /** Companion file manifest (paths only; fetch contents separately). */
  files: LlmSkillFileManifest[];
}

export interface LlmSkillFileInput {
  path: string;
  content: string;
  content_type?: string;
}

export interface SignalSourceConfig {
  id: string;
  source_product:
    | "session_replay"
    | "llm_analytics"
    | "github"
    | "linear"
    | "zendesk"
    | "conversations"
    | "error_tracking"
    | "pganalyze"
    | "signals_scout";
  source_type:
    | "session_analysis_cluster"
    | "evaluation"
    | "issue"
    | "ticket"
    | "issue_created"
    | "issue_reopened"
    | "issue_spiking"
    | "cross_source_issue";
  enabled: boolean;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  status: "running" | "completed" | "failed" | null;
}

// ── Signals scouts ───────────────────────────────────────────────────────────
// Backend: posthog `products/signals/backend/scout_harness/views.py`.
// Endpoints live under /api/projects/{id}/signals/scout/ and require the
// `signal_scout:read` / `signal_scout:write` scopes.

export interface ScoutConfig {
  id: string;
  skill_name: string;
  enabled: boolean;
  /** False means dry-run: the scout runs but findings are not emitted. */
  emit: boolean;
  run_interval_minutes: number;
  last_run_at: string | null;
  created_at: string;
}

export interface ScoutRun {
  run_id: string;
  skill_name: string;
  skill_version: number;
  /** TaskRun-derived status, e.g. "completed" | "failed" | "in_progress" | "queued". */
  status: string;
  started_at: string | null;
  completed_at: string | null;
  task_id: string | null;
  task_run_id: string | null;
  /** Relative PostHog cloud path to the backing task run. */
  task_url: string | null;
  summary: string;
  emitted_count: number | null;
  emitted_finding_ids: string[];
}

export interface ScoutEmission {
  id: string;
  run_id: string;
  finding_id: string;
  description: string;
  weight: number;
  confidence: number;
  severity: string | null;
  source_id: string;
  emitted_at: string;
}

export interface ScoutScratchpadEntry {
  key: string;
  content: string;
  created_at: string;
  updated_at: string;
  created_by_run_id: string | null;
}

export interface ScoutRunsQueryParams {
  date_from?: string;
  date_to?: string;
  text?: string;
  emitted?: boolean;
  limit?: number;
}

export interface ExternalDataSourceSchema {
  id: string;
  name: string;
  should_sync: boolean;
  /** e.g. `full_refresh` (full table replication), `incremental`, `append` */
  sync_type?: string | null;
}

export interface ExternalDataSource {
  id: string;
  source_type: string;
  status: string;
  // The generated `ExternalDataSourceSerializers` types this as `string`,
  // but the actual API returns an array of schema objects
  schemas?: ExternalDataSourceSchema[] | string;
}

export interface FolderInstructionsUser {
  id?: number;
  uuid?: string;
  first_name?: string;
  last_name?: string | null;
  email?: string;
}

export interface FolderInstructions {
  id: string;
  content: string;
  version: number;
  is_latest: boolean;
  created_by: FolderInstructionsUser | null;
  created_at: string;
  updated_at: string;
}

export interface FolderInstructionsVersion {
  id: string;
  version: number;
  is_latest: boolean;
  created_by: FolderInstructionsUser | null;
  created_at: string;
}

interface PaginatedFolderInstructionsVersions {
  count: number;
  next: string | null;
  previous: string | null;
  results: FolderInstructionsVersion[];
}

// Thrown when PUT /instructions/ rejects a publish because the caller's
// `base_version` is older than the current latest. Callers can re-fetch and
// retry against the new latest.
export class FolderInstructionsConflictError extends Error {
  status = 409;
  constructor(
    message = "Folder instructions changed since you started editing",
  ) {
    super(message);
    this.name = "FolderInstructionsConflictError";
  }
}

export interface TaskArtifactUploadRequest {
  name: string;
  type: "user_attachment";
  size: number;
  content_type?: string;
  source?: string;
}

export interface DirectUploadPresignedPost {
  url: string;
  fields: Record<string, string>;
}

export interface PreparedTaskArtifactUpload extends TaskArtifactUploadRequest {
  id: string;
  storage_path: string;
  expires_in: number;
  presigned_post: DirectUploadPresignedPost;
}

export interface FinalizedTaskArtifactUpload {
  id: string;
  name: string;
  type: string;
  source?: string;
  size?: number;
  content_type?: string;
  storage_path: string;
  uploaded_at?: string;
}

type CloudRuntimeAdapter = "claude" | "codex";

interface CloudRunOptions {
  adapter?: CloudRuntimeAdapter;
  model?: string;
  reasoningLevel?: string;
  sandboxEnvironmentId?: string;
  prAuthorshipMode?: PrAuthorshipMode;
  runSource?: CloudRunSource;
  signalReportId?: string;
  initialPermissionMode?: PermissionMode;
}

interface CreateTaskRunOptions extends CloudRunOptions {
  environment?: "local" | "cloud";
  mode?: "interactive" | "background";
  branch?: string | null;
}

interface StartTaskRunOptions {
  pendingUserMessage?: string;
  pendingUserArtifactIds?: string[];
}

function buildCloudRunRequestBody(
  options?: CloudRunOptions & {
    branch?: string | null;
    mode?: "interactive" | "background";
    resumeFromRunId?: string;
    pendingUserMessage?: string;
    pendingUserArtifactIds?: string[];
  },
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    mode: options?.mode ?? "interactive",
  };

  if (options?.branch) {
    body.branch = options.branch;
  }
  if (options?.adapter) {
    body.runtime_adapter = options.adapter;
    if (options.model) {
      body.model = options.model;
    }
    if (options.reasoningLevel) {
      if (!options.model) {
        throw new Error(
          "A cloud reasoning level requires a model to be selected.",
        );
      }
      if (
        !isSupportedReasoningEffort(
          options.adapter,
          options.model,
          options.reasoningLevel,
        )
      ) {
        throw new Error(
          `Reasoning effort '${options.reasoningLevel}' is not supported for ${options.adapter} model '${options.model}'.`,
        );
      }
      body.reasoning_effort = options.reasoningLevel;
    }
  }
  if (options?.resumeFromRunId) {
    body.resume_from_run_id = options.resumeFromRunId;
  }
  if (options?.pendingUserMessage) {
    body.pending_user_message = options.pendingUserMessage;
  }
  if (options?.pendingUserArtifactIds?.length) {
    body.pending_user_artifact_ids = options.pendingUserArtifactIds;
  }
  if (options?.sandboxEnvironmentId) {
    body.sandbox_environment_id = options.sandboxEnvironmentId;
  }
  if (options?.prAuthorshipMode) {
    body.pr_authorship_mode = options.prAuthorshipMode;
  }
  if (options?.runSource) {
    body.run_source = options.runSource;
  }
  if (options?.signalReportId) {
    body.signal_report_id = options.signalReportId;
  }
  if (options?.initialPermissionMode) {
    body.initial_permission_mode = options.initialPermissionMode;
  }

  return body;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

type AnyArtefact =
  | SignalReportArtefact
  | PriorityJudgmentArtefact
  | ActionabilityJudgmentArtefact
  | SignalFindingArtefact
  | RepoSelectionArtefact
  | SuggestedReviewersArtefact
  | DismissalArtefact;

const DISMISSAL_REASONS = new Set<DismissalReasonOptionValue>(
  DISMISSAL_REASON_OPTIONS.map((o) => o.value),
);

const PRIORITY_VALUES = new Set(["P0", "P1", "P2", "P3", "P4"]);

function normalizePriorityJudgmentArtefact(
  value: Record<string, unknown>,
): PriorityJudgmentArtefact | null {
  const id = optionalString(value.id);
  if (!id) return null;

  const contentValue = isObjectRecord(value.content) ? value.content : null;
  if (!contentValue) return null;

  const priority = optionalString(contentValue.priority);
  if (!priority || !PRIORITY_VALUES.has(priority)) return null;

  return {
    id,
    type: "priority_judgment",
    created_at: optionalString(value.created_at) ?? new Date(0).toISOString(),
    content: {
      explanation: optionalString(contentValue.explanation) ?? "",
      priority: priority as PriorityJudgmentArtefact["content"]["priority"],
    },
  };
}

const ACTIONABILITY_VALUES = new Set([
  "immediately_actionable",
  "requires_human_input",
  "not_actionable",
]);

function normalizeActionabilityJudgmentArtefact(
  value: Record<string, unknown>,
): ActionabilityJudgmentArtefact | null {
  const id = optionalString(value.id);
  if (!id) return null;

  const contentValue = isObjectRecord(value.content) ? value.content : null;
  if (!contentValue) return null;

  // Support both agentic ("actionability") and legacy ("choice") field names
  const actionability =
    optionalString(contentValue.actionability) ??
    optionalString(contentValue.choice);
  if (!actionability || !ACTIONABILITY_VALUES.has(actionability)) return null;

  return {
    id,
    type: "actionability_judgment",
    created_at: optionalString(value.created_at) ?? new Date(0).toISOString(),
    content: {
      explanation: optionalString(contentValue.explanation) ?? "",
      actionability:
        actionability as ActionabilityJudgmentArtefact["content"]["actionability"],
      already_addressed:
        typeof contentValue.already_addressed === "boolean"
          ? contentValue.already_addressed
          : false,
    },
  };
}

function normalizeSignalFindingArtefact(
  value: Record<string, unknown>,
): SignalFindingArtefact | null {
  const id = optionalString(value.id);
  if (!id) return null;

  const contentValue = isObjectRecord(value.content) ? value.content : null;
  if (!contentValue) return null;

  const signalId = optionalString(contentValue.signal_id);
  if (!signalId) return null;

  return {
    id,
    type: "signal_finding",
    created_at: optionalString(value.created_at) ?? new Date(0).toISOString(),
    content: {
      signal_id: signalId,
      relevant_code_paths: Array.isArray(contentValue.relevant_code_paths)
        ? contentValue.relevant_code_paths.filter(
            (p: unknown): p is string => typeof p === "string",
          )
        : [],
      relevant_commit_hashes: isObjectRecord(
        contentValue.relevant_commit_hashes,
      )
        ? Object.fromEntries(
            Object.entries(contentValue.relevant_commit_hashes).filter(
              (e): e is [string, string] => typeof e[1] === "string",
            ),
          )
        : {},
      data_queried: optionalString(contentValue.data_queried) ?? "",
      verified:
        typeof contentValue.verified === "boolean"
          ? contentValue.verified
          : false,
    },
  };
}

function normalizeRepoSelectionArtefact(
  value: Record<string, unknown>,
): RepoSelectionArtefact | null {
  const id = optionalString(value.id);
  if (!id) return null;

  const contentValue = isObjectRecord(value.content) ? value.content : null;
  if (!contentValue) return null;

  return {
    id,
    type: "repo_selection",
    created_at: optionalString(value.created_at) ?? new Date(0).toISOString(),
    content: {
      repository: optionalString(contentValue.repository),
      reason: optionalString(contentValue.reason) ?? "",
    },
  };
}

function normalizeDismissalArtefact(
  value: Record<string, unknown>,
): DismissalArtefact | null {
  const id = optionalString(value.id);
  if (!id) return null;

  const contentValue = isObjectRecord(value.content) ? value.content : null;
  if (!contentValue) return null;

  const rawReason = optionalString(contentValue.reason);
  const reason =
    rawReason && DISMISSAL_REASONS.has(rawReason as DismissalReasonOptionValue)
      ? (rawReason as DismissalReasonOptionValue)
      : null;

  if (reason == null) {
    return null;
  }

  return {
    id,
    type: "dismissal",
    created_at: optionalString(value.created_at) ?? new Date(0).toISOString(),
    content: {
      reason,
      note: optionalString(contentValue.note) ?? "",
      user_id:
        typeof contentValue.user_id === "number" ? contentValue.user_id : null,
      user_uuid: optionalString(contentValue.user_uuid),
    },
  };
}

function normalizeSignalReportArtefact(value: unknown): AnyArtefact | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  const dispatchType = optionalString(value.type);
  if (dispatchType === "signal_finding") {
    return normalizeSignalFindingArtefact(value);
  }
  if (dispatchType === "actionability_judgment") {
    return normalizeActionabilityJudgmentArtefact(value);
  }
  if (dispatchType === "priority_judgment") {
    return normalizePriorityJudgmentArtefact(value);
  }
  if (dispatchType === "repo_selection") {
    return normalizeRepoSelectionArtefact(value);
  }
  if (dispatchType === "dismissal") {
    return normalizeDismissalArtefact(value);
  }

  const id = optionalString(value.id);
  if (!id) {
    return null;
  }

  const type = dispatchType ?? "unknown";
  const created_at =
    optionalString(value.created_at) ?? new Date(0).toISOString();

  // suggested_reviewers: content is an array of reviewer objects
  if (type === "suggested_reviewers" && Array.isArray(value.content)) {
    return {
      id,
      type: "suggested_reviewers" as const,
      created_at,
      content: value.content as SuggestedReviewersArtefact["content"],
    };
  }

  // video_segment and other artefacts with object content
  const contentValue = isObjectRecord(value.content) ? value.content : null;
  if (!contentValue) {
    return null;
  }

  const content = optionalString(contentValue.content);
  const sessionId = optionalString(contentValue.session_id);

  // The backend may return empty content objects when binary decode fails.
  if (!content && !sessionId) {
    return null;
  }

  return {
    id,
    type,
    created_at,
    content: {
      session_id: sessionId ?? "",
      start_time: optionalString(contentValue.start_time) ?? "",
      end_time: optionalString(contentValue.end_time) ?? "",
      distinct_id: optionalString(contentValue.distinct_id) ?? "",
      content: content ?? "",
      distance_to_centroid:
        typeof contentValue.distance_to_centroid === "number"
          ? contentValue.distance_to_centroid
          : null,
    },
  };
}

function parseSignalReportArtefactsPayload(
  value: unknown,
): SignalReportArtefactsResponse {
  const payload = isObjectRecord(value) ? value : null;
  const rawResults = Array.isArray(payload?.results)
    ? payload.results
    : Array.isArray(value)
      ? value
      : [];

  const results = rawResults
    .map(normalizeSignalReportArtefact)
    .filter((artefact): artefact is AnyArtefact => artefact !== null);
  const count =
    typeof payload?.count === "number" ? payload.count : results.length;

  if (rawResults.length > 0 && results.length === 0) {
    return {
      results: [],
      count: 0,
      unavailableReason: "invalid_payload",
    };
  }

  return {
    results,
    count,
  };
}

function normalizeAvailableSuggestedReviewer(
  uuid: string,
  value: unknown,
): AvailableSuggestedReviewer | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  const normalizedUuid = optionalString(uuid);
  if (!normalizedUuid) {
    return null;
  }

  return {
    uuid: normalizedUuid,
    name: optionalString(value.name) ?? "",
    email: optionalString(value.email) ?? "",
    github_login: optionalString(value.github_login) ?? "",
  };
}

function parseAvailableSuggestedReviewersPayload(
  value: unknown,
): AvailableSuggestedReviewersResponse {
  if (!isObjectRecord(value)) {
    return {
      results: [],
      count: 0,
    };
  }

  const results = Object.entries(value)
    .map(([uuid, reviewer]) =>
      normalizeAvailableSuggestedReviewer(uuid, reviewer),
    )
    .filter(
      (reviewer): reviewer is AvailableSuggestedReviewer => reviewer !== null,
    );

  return {
    results,
    count: results.length,
  };
}

export class PostHogAPIClient {
  private api: ReturnType<typeof createApiClient>;
  private _teamId: number | null = null;

  constructor(
    apiHost: string,
    getAccessToken: () => Promise<string>,
    refreshAccessToken: () => Promise<string>,
    teamId?: number,
  ) {
    const baseUrl = apiHost.endsWith("/") ? apiHost.slice(0, -1) : apiHost;
    this.api = createApiClient(
      buildApiFetcher({
        getAccessToken,
        refreshAccessToken,
        appVersion: clientAppVersion,
      }),
      baseUrl,
    );
    if (teamId) {
      this._teamId = teamId;
    }
  }

  setTeamId(teamId: number | null | undefined): void {
    this._teamId = teamId ?? null;
  }

  private async getTeamId(): Promise<number> {
    if (this._teamId !== null) {
      return this._teamId;
    }

    const user = await this.api.get("/api/users/{uuid}/", {
      path: { uuid: "@me" },
    });

    if (user?.team?.id) {
      this._teamId = user.team.id;
      return this._teamId;
    }

    throw new Error("No team found for user");
  }

  async getCurrentUser() {
    const data = await this.api.get("/api/users/{uuid}/", {
      path: { uuid: "@me" },
    });
    return data;
  }

  // Desktop file system — the backend surface that backs canvas channels
  // (top-level folders) and dashboards. These routes aren't in the generated
  // OpenAPI client, so we use the raw fetcher.
  async getDesktopFileSystem(): Promise<Schemas.FileSystem[]> {
    const DESKTOP_FILE_SYSTEM_MAX_PAGES = 50;
    const teamId = await this.getTeamId();
    const all: Schemas.FileSystem[] = [];
    let urlPath: string = `/api/projects/${teamId}/desktop_file_system/`;
    for (let i = 0; i < DESKTOP_FILE_SYSTEM_MAX_PAGES; i++) {
      const url = new URL(`${this.api.baseUrl}${urlPath}`);
      const response = await this.api.fetcher.fetch({
        method: "get",
        url,
        path: urlPath,
      });
      if (!response.ok) {
        throw new Error(
          `Failed to fetch desktop file system: ${response.statusText}`,
        );
      }
      const page = (await response.json()) as Schemas.PaginatedFileSystemList;
      all.push(...page.results);
      if (!page.next) return all;
      const nextUrl = new URL(page.next);
      urlPath = `${nextUrl.pathname}${nextUrl.search}`;
    }
    log.warn(
      `getDesktopFileSystem hit MAX_PAGES (${DESKTOP_FILE_SYSTEM_MAX_PAGES}); returning partial results`,
      { returned: all.length },
    );
    return all;
  }

  // Create a top-level channel (a folder row whose path is a single segment).
  async createDesktopFileSystemChannel(
    name: string,
  ): Promise<Schemas.FileSystem> {
    const teamId = await this.getTeamId();
    const urlPath = `/api/projects/${teamId}/desktop_file_system/`;
    const url = new URL(`${this.api.baseUrl}${urlPath}`);
    const response = await this.api.fetcher.fetch({
      method: "post",
      url,
      path: urlPath,
      overrides: {
        body: JSON.stringify({ path: name, type: "folder", depth: 1 }),
      },
    });
    if (!response.ok) {
      throw new Error(
        `Failed to create desktop file system channel: ${response.statusText}`,
      );
    }
    return (await response.json()) as Schemas.FileSystem;
  }

  // Rename a top-level channel: PATCH its path (a single segment) to the new
  // name. The backend recomputes depth from the path.
  async renameDesktopFileSystemChannel(
    id: string,
    name: string,
  ): Promise<Schemas.FileSystem> {
    const teamId = await this.getTeamId();
    const urlPath = `/api/projects/${teamId}/desktop_file_system/${encodeURIComponent(id)}/`;
    const url = new URL(`${this.api.baseUrl}${urlPath}`);
    const response = await this.api.fetcher.fetch({
      method: "patch",
      url,
      path: urlPath,
      overrides: {
        body: JSON.stringify({ path: name }),
      },
    });
    if (!response.ok) {
      throw new Error(
        `Failed to rename desktop file system channel: ${response.statusText}`,
      );
    }
    return (await response.json()) as Schemas.FileSystem;
  }

  // Delete a desktop file system entry by id (used to remove top-level channels).
  async deleteDesktopFileSystem(id: string): Promise<void> {
    const teamId = await this.getTeamId();
    const urlPath = `/api/projects/${teamId}/desktop_file_system/${encodeURIComponent(id)}/`;
    const url = new URL(`${this.api.baseUrl}${urlPath}`);
    const response = await this.api.fetcher.fetch({
      method: "delete",
      url,
      path: urlPath,
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(
        `Failed to delete desktop file system channel: ${response.statusText}`,
      );
    }
  }

  // Per-folder, versioned markdown instructions for a desktop folder. The
  // endpoint is keyed on the FileSystem row id (must be `type === "folder"`).
  // Returns the current latest version or null when none has been published.
  async getDesktopFolderInstructions(
    folderId: string,
  ): Promise<FolderInstructions | null> {
    const teamId = await this.getTeamId();
    const urlPath = `/api/projects/${teamId}/desktop_file_system/${encodeURIComponent(folderId)}/instructions/`;
    const url = new URL(`${this.api.baseUrl}${urlPath}`);
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: urlPath,
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(
        `Failed to fetch folder instructions: ${response.statusText}`,
      );
    }
    return (await response.json()) as FolderInstructions;
  }

  // Publish a new version of the folder's instructions. Pass `base_version`
  // (the latest version the editor was started from) for optimistic
  // concurrency; use 0 when no instructions exist yet. A 409 turns into a
  // typed `FolderInstructionsConflictError` so the UI can prompt to reload.
  async putDesktopFolderInstructions(
    folderId: string,
    input: { content: string; base_version?: number },
  ): Promise<FolderInstructions> {
    const teamId = await this.getTeamId();
    const urlPath = `/api/projects/${teamId}/desktop_file_system/${encodeURIComponent(folderId)}/instructions/`;
    const url = new URL(`${this.api.baseUrl}${urlPath}`);
    const response = await this.api.fetcher.fetch({
      method: "put",
      url,
      path: urlPath,
      overrides: {
        body: JSON.stringify(input),
      },
    });
    if (response.status === 409) {
      throw new FolderInstructionsConflictError();
    }
    if (!response.ok) {
      throw new Error(
        `Failed to publish folder instructions: ${response.statusText}`,
      );
    }
    return (await response.json()) as FolderInstructions;
  }

  // Soft-delete all versions of this folder's instructions. The folder row
  // itself is not affected.
  async deleteDesktopFolderInstructions(folderId: string): Promise<void> {
    const teamId = await this.getTeamId();
    const urlPath = `/api/projects/${teamId}/desktop_file_system/${encodeURIComponent(folderId)}/instructions/`;
    const url = new URL(`${this.api.baseUrl}${urlPath}`);
    const response = await this.api.fetcher.fetch({
      method: "delete",
      url,
      path: urlPath,
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(
        `Failed to delete folder instructions: ${response.statusText}`,
      );
    }
  }

  // List version metadata (no content) newest-first. Single page is enough for
  // the typical UI; we cap follow-up pages to avoid runaway pagination on
  // pathological histories.
  async listDesktopFolderInstructionVersions(
    folderId: string,
  ): Promise<FolderInstructionsVersion[]> {
    const VERSIONS_MAX_PAGES = 20;
    const teamId = await this.getTeamId();
    const all: FolderInstructionsVersion[] = [];
    let urlPath = `/api/projects/${teamId}/desktop_file_system/${encodeURIComponent(folderId)}/instructions/versions/`;
    for (let i = 0; i < VERSIONS_MAX_PAGES; i++) {
      const url = new URL(`${this.api.baseUrl}${urlPath}`);
      const response = await this.api.fetcher.fetch({
        method: "get",
        url,
        path: urlPath,
      });
      if (!response.ok) {
        throw new Error(
          `Failed to fetch folder instruction versions: ${response.statusText}`,
        );
      }
      const page =
        (await response.json()) as PaginatedFolderInstructionsVersions;
      all.push(...page.results);
      if (!page.next) return all;
      const nextUrl = new URL(page.next);
      urlPath = `${nextUrl.pathname}${nextUrl.search}`;
    }
    log.warn(
      `listDesktopFolderInstructionVersions hit MAX_PAGES (${VERSIONS_MAX_PAGES}); returning partial results`,
      { folderId, returned: all.length },
    );
    return all;
  }

  async getGithubLogin(): Promise<string | null> {
    const data = (await this.api.get("/api/users/{uuid}/github_login/", {
      path: { uuid: "@me" },
    })) as { github_login: string | null };
    return data.github_login;
  }

  /**
   * `POST .../integrations/github/start/`. Optional `teamId` matches app project when session `current_team` differs.
   */
  async startGithubUserIntegrationConnect(teamId?: number): Promise<{
    install_url: string;
    connect_flow?: "oauth_authorize" | "oauth_discover" | "app_install";
  }> {
    const id = teamId ?? (await this.getTeamId());
    const urlPath = `/api/users/@me/integrations/github/start/`;
    const url = new URL(`${this.api.baseUrl}${urlPath}`);
    const response = await this.api.fetcher.fetch({
      method: "post",
      url,
      path: urlPath,
      overrides: {
        body: JSON.stringify({ team_id: id, connect_from: "posthog_code" }),
      },
    });
    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as {
        detail?: unknown;
      };
      const detail =
        typeof err.detail === "string"
          ? err.detail
          : "Failed to start GitHub connection";
      throw new Error(detail);
    }
    return (await response.json()) as {
      install_url: string;
      connect_flow?: "oauth_authorize" | "oauth_discover" | "app_install";
    };
  }

  async getGithubUserIntegrations(): Promise<UserGitHubIntegration[]> {
    const urlPath = `/api/users/@me/integrations/`;
    const url = new URL(`${this.api.baseUrl}${urlPath}`);
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: urlPath,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch personal GitHub integrations: ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      results?: UserGitHubIntegration[];
    };
    return data.results ?? [];
  }

  async disconnectGithubUserIntegration(installationId: string): Promise<void> {
    const urlPath = `/api/users/@me/integrations/github/${encodeURIComponent(installationId)}/`;
    const url = new URL(`${this.api.baseUrl}${urlPath}`);
    const response = await this.api.fetcher.fetch({
      method: "delete",
      url,
      path: urlPath,
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(
        `Failed to disconnect GitHub integration: ${response.statusText}`,
      );
    }
  }

  async switchOrganization(orgId: string): Promise<void> {
    await this.api.patch("/api/users/{uuid}/", {
      path: { uuid: "@me" },
      body: { set_current_organization: orgId } as Record<string, unknown>,
    });
  }

  async approveAiDataProcessing(): Promise<void> {
    const urlPath = `/api/organizations/@current/`;
    const url = new URL(`${this.api.baseUrl}${urlPath}`);
    await this.api.fetcher.fetch({
      method: "patch",
      url,
      path: urlPath,
      overrides: {
        body: JSON.stringify({ is_ai_data_processing_approved: true }),
      },
    });
  }

  async getProject(projectId: number) {
    //@ts-expect-error this is not in the generated client
    const data = await this.api.get("/api/projects/{project_id}/", {
      path: { project_id: projectId.toString() },
    });
    return data as Schemas.Team;
  }

  async getHomeSnapshot(): Promise<unknown> {
    const teamId = await this.getTeamId();
    const urlPath = `/api/projects/${teamId}/code_home/`;
    const response = await this.api.fetcher.fetch({
      method: "get",
      url: new URL(`${this.api.baseUrl}${urlPath}`),
      path: urlPath,
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch home snapshot: ${response.status}`);
    }
    return response.json();
  }

  async refreshHomeSnapshot(): Promise<void> {
    const teamId = await this.getTeamId();
    const urlPath = `/api/projects/${teamId}/code_home/refresh/`;
    const response = await this.api.fetcher.fetch({
      method: "post",
      url: new URL(`${this.api.baseUrl}${urlPath}`),
      path: urlPath,
    });
    if (!response.ok) {
      throw new Error(`Failed to request home refresh: ${response.status}`);
    }
  }

  async getCodeWorkflow(): Promise<unknown> {
    const teamId = await this.getTeamId();
    const urlPath = `/api/projects/${teamId}/code_workflow/`;
    const response = await this.api.fetcher.fetch({
      method: "get",
      url: new URL(`${this.api.baseUrl}${urlPath}`),
      path: urlPath,
    });
    if (!response.ok) {
      throw new Error(`Workflow request failed: ${response.status}`);
    }
    return response.json();
  }

  // 409/422 carry a structured save-result body the caller validates.
  async saveCodeWorkflow(body: {
    config: unknown;
    expectedVersion: number;
  }): Promise<unknown> {
    const teamId = await this.getTeamId();
    const urlPath = `/api/projects/${teamId}/code_workflow/save/`;
    const response = await this.api.fetcher.fetch({
      method: "post",
      url: new URL(`${this.api.baseUrl}${urlPath}`),
      path: urlPath,
      overrides: {
        body: JSON.stringify(body),
      },
    });
    if (!response.ok && response.status !== 409 && response.status !== 422) {
      throw new Error(`Workflow request failed: ${response.status}`);
    }
    return response.json();
  }

  async resetCodeWorkflow(): Promise<unknown> {
    const teamId = await this.getTeamId();
    const urlPath = `/api/projects/${teamId}/code_workflow/reset/`;
    const response = await this.api.fetcher.fetch({
      method: "post",
      url: new URL(`${this.api.baseUrl}${urlPath}`),
      path: urlPath,
    });
    if (!response.ok) {
      throw new Error(`Workflow request failed: ${response.status}`);
    }
    return response.json();
  }

  async listSignalSourceConfigs(
    projectId: number,
  ): Promise<SignalSourceConfig[]> {
    const urlPath = `/api/projects/${projectId}/signals/source_configs/`;
    const url = new URL(`${this.api.baseUrl}${urlPath}`);
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: urlPath,
    });
    if (!response.ok) {
      throw new Error(
        `Failed to fetch signal source configs: ${response.statusText}`,
      );
    }
    const data = (await response.json()) as
      | { results: SignalSourceConfig[] }
      | SignalSourceConfig[];
    return Array.isArray(data) ? data : (data.results ?? []);
  }

  async createSignalSourceConfig(
    projectId: number,
    options: {
      source_product: SignalSourceConfig["source_product"];
      source_type: SignalSourceConfig["source_type"];
      enabled: boolean;
      config?: Record<string, unknown>;
    },
  ): Promise<SignalSourceConfig> {
    const urlPath = `/api/projects/${projectId}/signals/source_configs/`;
    const url = new URL(`${this.api.baseUrl}${urlPath}`);
    const response = await this.api.fetcher.fetch({
      method: "post",
      url,
      path: urlPath,
      overrides: {
        body: JSON.stringify(options),
      },
    });
    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as {
        detail?: string;
      };
      throw new Error(
        errorData.detail ??
          `Failed to create signal source config: ${response.statusText}`,
      );
    }
    return (await response.json()) as SignalSourceConfig;
  }

  async updateSignalSourceConfig(
    projectId: number,
    configId: string,
    updates: { enabled: boolean },
  ): Promise<SignalSourceConfig> {
    const urlPath = `/api/projects/${projectId}/signals/source_configs/${configId}/`;
    const url = new URL(`${this.api.baseUrl}${urlPath}`);
    const response = await this.api.fetcher.fetch({
      method: "patch",
      url,
      path: urlPath,
      overrides: {
        body: JSON.stringify(updates),
      },
    });
    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as {
        detail?: string;
      };
      throw new Error(
        errorData.detail ??
          `Failed to update signal source config: ${response.statusText}`,
      );
    }
    return (await response.json()) as SignalSourceConfig;
  }

  private async scoutGet<T>(
    projectId: number,
    subPath: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const urlPath = `/api/projects/${projectId}/signals/scout/${subPath}`;
    const url = new URL(`${this.api.baseUrl}${urlPath}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: urlPath,
    });
    if (!response.ok) {
      throw new Error(
        `Scout request failed (${subPath}): ${response.statusText}`,
      );
    }
    return (await response.json()) as T;
  }

  async listScoutConfigs(projectId: number): Promise<ScoutConfig[]> {
    const data = await this.scoutGet<
      { results: ScoutConfig[] } | ScoutConfig[]
    >(projectId, "configs/");
    return Array.isArray(data) ? data : (data.results ?? []);
  }

  async updateScoutConfig(
    projectId: number,
    configId: string,
    updates: {
      enabled?: boolean;
      emit?: boolean;
      run_interval_minutes?: number;
    },
  ): Promise<ScoutConfig> {
    const urlPath = `/api/projects/${projectId}/signals/scout/configs/${configId}/`;
    const url = new URL(`${this.api.baseUrl}${urlPath}`);
    const response = await this.api.fetcher.fetch({
      method: "patch",
      url,
      path: urlPath,
      overrides: {
        body: JSON.stringify(updates),
      },
    });
    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as {
        detail?: string;
      };
      throw new Error(
        errorData.detail ??
          `Failed to update scout config: ${response.statusText}`,
      );
    }
    return (await response.json()) as ScoutConfig;
  }

  async listScoutRuns(
    projectId: number,
    params?: ScoutRunsQueryParams,
  ): Promise<ScoutRun[]> {
    const data = await this.scoutGet<{ results: ScoutRun[] } | ScoutRun[]>(
      projectId,
      "runs/",
      {
        date_from: params?.date_from,
        date_to: params?.date_to,
        text: params?.text,
        emitted: params?.emitted,
        limit: params?.limit,
      },
    );
    return Array.isArray(data) ? data : (data.results ?? []);
  }

  async getScoutRun(projectId: number, runId: string): Promise<ScoutRun> {
    return await this.scoutGet<ScoutRun>(projectId, `runs/${runId}/`);
  }

  async listScoutRunEmissions(
    projectId: number,
    runId: string,
  ): Promise<ScoutEmission[]> {
    const data = await this.scoutGet<
      { results: ScoutEmission[] } | ScoutEmission[]
    >(projectId, `runs/${runId}/emissions/`);
    return Array.isArray(data) ? data : (data.results ?? []);
  }

  async searchScoutScratchpad(
    projectId: number,
    params?: { text?: string; limit?: number },
  ): Promise<ScoutScratchpadEntry[]> {
    const data = await this.scoutGet<
      { results: ScoutScratchpadEntry[] } | ScoutScratchpadEntry[]
    >(projectId, "scratchpad/", {
      text: params?.text,
      limit: params?.limit,
    });
    return Array.isArray(data) ? data : (data.results ?? []);
  }

  async listEvaluations(projectId: number): Promise<Evaluation[]> {
    const data = await this.api.get(
      "/api/environments/{project_id}/evaluations/",
      {
        path: { project_id: projectId.toString() },
        query: { limit: 200 },
      },
    );
    return data.results ?? [];
  }

  async updateEvaluation(
    projectId: number,
    evaluationId: string,
    updates: { enabled: boolean },
  ): Promise<Evaluation> {
    return await this.api.patch(
      "/api/environments/{project_id}/evaluations/{id}/",
      {
        path: {
          project_id: projectId.toString(),
          id: evaluationId,
        },
        body: updates,
      },
    );
  }

  async listExternalDataSources(
    projectId: number,
  ): Promise<ExternalDataSource[]> {
    const data = (await this.api.get(
      "/api/projects/{project_id}/external_data_sources/",
      {
        path: { project_id: projectId.toString() },
        query: {},
      },
    )) as unknown as { results?: ExternalDataSource[] } | ExternalDataSource[];
    return Array.isArray(data) ? data : (data.results ?? []);
  }

  async createExternalDataSource(
    projectId: number,
    payload: {
      source_type: string;
      payload: Record<string, unknown>;
    },
  ): Promise<ExternalDataSource> {
    const response = await this.api.post(
      "/api/projects/{project_id}/external_data_sources/",
      {
        path: { project_id: projectId.toString() },
        body: payload as unknown as Schemas.ExternalDataSourceCreate,
        withResponse: true,
        throwOnStatusError: false,
      },
    );
    if (!response.ok) {
      const errorData = isObjectRecord(response.data)
        ? (response.data as { detail?: string })
        : {};
      throw new Error(
        errorData.detail ??
          `Failed to create external data source: ${response.statusText}`,
      );
    }
    return response.data as unknown as ExternalDataSource;
  }

  async updateExternalDataSchema(
    projectId: number,
    schemaId: string,
    updates: { should_sync: boolean; sync_type?: string },
  ): Promise<void> {
    const urlPath = `/api/projects/${projectId}/external_data_schemas/${schemaId}/`;
    const url = new URL(`${this.api.baseUrl}${urlPath}`);
    const response = await this.api.fetcher.fetch({
      method: "patch",
      url,
      path: urlPath,
      overrides: {
        body: JSON.stringify(updates),
      },
    });
    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as {
        detail?: string;
      };
      throw new Error(
        errorData.detail ??
          `Failed to update external data schema: ${response.statusText}`,
      );
    }
  }

  async getTasks(options?: {
    repository?: string;
    createdBy?: number;
    originProduct?: string;
    internal?: boolean;
  }) {
    const teamId = await this.getTeamId();
    const params: Record<string, string | number | boolean> = {
      limit: 500,
    };

    if (options?.repository) {
      params.repository = options.repository;
    }

    if (options?.createdBy) {
      params.created_by = options.createdBy;
    }

    if (options?.originProduct) {
      params.origin_product = options.originProduct;
    }

    if (options?.internal) {
      params.internal = true;
    }

    const data = await this.api.get(`/api/projects/{project_id}/tasks/`, {
      path: { project_id: teamId.toString() },
      query: params,
    });

    return data.results ?? [];
  }

  async getTaskSummaries(ids: string[]) {
    if (ids.length === 0) return [];
    const TASK_SUMMARIES_MAX_PAGES = 50;
    const teamId = await this.getTeamId();
    const all: Schemas.TaskSummary[] = [];
    let urlPath: string = `/api/projects/${teamId}/tasks/summaries/`;
    for (let i = 0; i < TASK_SUMMARIES_MAX_PAGES; i++) {
      const url = new URL(`${this.api.baseUrl}${urlPath}`);
      const response = await this.api.fetcher.fetch({
        method: "post",
        url,
        path: urlPath,
        overrides: {
          body: JSON.stringify({ ids } satisfies Schemas.TaskSummariesRequest),
        },
      });
      if (!response.ok) {
        throw new Error(
          `Failed to fetch task summaries: ${response.statusText}`,
        );
      }
      const page = (await response.json()) as Schemas.PaginatedTaskSummaryList;
      all.push(...page.results);
      if (!page.next) return all;
      const nextUrl = new URL(page.next);
      urlPath = `${nextUrl.pathname}${nextUrl.search}`;
    }
    log.warn(
      `getTaskSummaries hit MAX_PAGES (${TASK_SUMMARIES_MAX_PAGES}); returning partial results`,
      { ids: ids.length, returned: all.length },
    );
    return all;
  }

  async getTask(taskId: string): Promise<Task> {
    const teamId = await this.getTeamId();
    const data = await this.api.get(`/api/projects/{project_id}/tasks/{id}/`, {
      path: { project_id: teamId.toString(), id: taskId },
    });
    return data as unknown as Task;
  }

  async createTask(
    options: Pick<Task, "description"> &
      Partial<
        Pick<
          Task,
          | "title"
          | "repository"
          | "json_schema"
          | "origin_product"
          | "signal_report"
        >
      > & {
        github_integration?: number | null;
        github_user_integration?: string | null;
        /** POST-only: `SignalReportTask.relationship` to create when linking to `signal_report`. */
        signal_report_task_relationship?: SignalReportTaskRelationship;
      },
  ) {
    const teamId = await this.getTeamId();
    const { origin_product: originProduct, ...taskOptions } = options;

    const data = await this.api.post(`/api/projects/{project_id}/tasks/`, {
      path: { project_id: teamId.toString() },
      body: {
        ...taskOptions,
        origin_product: originProduct ?? "user_created",
      } as unknown as Schemas.Task,
    });

    return data;
  }

  async updateTask(taskId: string, updates: Partial<Schemas.Task>) {
    const teamId = await this.getTeamId();
    const data = await this.api.patch(
      `/api/projects/{project_id}/tasks/{id}/`,
      {
        path: { project_id: teamId.toString(), id: taskId },
        body: updates,
      },
    );

    return data;
  }

  async deleteTask(taskId: string) {
    const teamId = await this.getTeamId();
    await this.api.delete(`/api/projects/{project_id}/tasks/{id}/`, {
      path: { project_id: teamId.toString(), id: taskId },
    });
  }

  async duplicateTask(taskId: string) {
    const task = await this.getTask(taskId);
    return this.createTask({
      description: task.description ?? "",
      title: task.title,
      repository: task.repository,
      json_schema: task.json_schema,
      origin_product: task.origin_product,
      github_integration: task.github_integration,
      github_user_integration: task.github_user_integration,
    });
  }

  async sendRunCommand(
    taskId: string,
    runId: string,
    method: "user_message" | "cancel" | "close",
    params?: Record<string, unknown>,
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/projects/${teamId}/tasks/${taskId}/runs/${runId}/command/`,
    );
    const body = {
      jsonrpc: "2.0",
      method,
      params: params ?? {},
      id: `posthog-code-${Date.now()}`,
    };

    try {
      const response = await this.api.fetcher.fetch({
        method: "post",
        url,
        path: `/api/projects/${teamId}/tasks/${taskId}/runs/${runId}/command/`,
        overrides: {
          body: JSON.stringify(body),
        },
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        let errorMessage = `Command failed: ${response.statusText}`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage =
            errorJson.error?.message ?? errorJson.error ?? errorMessage;
        } catch {
          if (errorText) errorMessage = errorText;
        }
        return { success: false, error: errorMessage };
      }

      const data = (await response.json()) as {
        error?: { message?: string };
        result?: unknown;
      };
      if (data.error) {
        return {
          success: false,
          error: data.error.message ?? JSON.stringify(data.error),
        };
      }

      return { success: true, result: data.result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async runTaskInCloud(
    taskId: string,
    branch?: string | null,
    options?: CloudRunOptions & {
      resumeFromRunId?: string;
      pendingUserMessage?: string;
      pendingUserArtifactIds?: string[];
    },
  ): Promise<Task> {
    const teamId = await this.getTeamId();
    const body = buildCloudRunRequestBody({
      ...options,
      branch,
      mode: "interactive",
    });

    const data = await this.withCloudUsageLimitCheck(() =>
      this.api.post(`/api/projects/{project_id}/tasks/{id}/run/`, {
        path: { project_id: teamId.toString(), id: taskId },
        body,
      }),
    );

    return data as unknown as Task;
  }

  async prepareTaskStagedArtifactUploads(
    taskId: string,
    artifacts: TaskArtifactUploadRequest[],
  ): Promise<PreparedTaskArtifactUpload[]> {
    if (!artifacts.length) {
      return [];
    }

    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/projects/${teamId}/tasks/${taskId}/staged_artifacts/prepare_upload/`,
    );
    const response = await this.api.fetcher.fetch({
      method: "post",
      url,
      path: `/api/projects/${teamId}/tasks/${taskId}/staged_artifacts/prepare_upload/`,
      overrides: {
        body: JSON.stringify({ artifacts }),
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to prepare staged uploads: ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      artifacts?: PreparedTaskArtifactUpload[];
    };
    return data.artifacts ?? [];
  }

  async finalizeTaskStagedArtifactUploads(
    taskId: string,
    artifacts: PreparedTaskArtifactUpload[],
  ): Promise<FinalizedTaskArtifactUpload[]> {
    if (!artifacts.length) {
      return [];
    }

    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/projects/${teamId}/tasks/${taskId}/staged_artifacts/finalize_upload/`,
    );
    const response = await this.api.fetcher.fetch({
      method: "post",
      url,
      path: `/api/projects/${teamId}/tasks/${taskId}/staged_artifacts/finalize_upload/`,
      overrides: {
        body: JSON.stringify({
          artifacts: artifacts.map((artifact) => ({
            id: artifact.id,
            name: artifact.name,
            type: artifact.type,
            source: artifact.source,
            content_type: artifact.content_type,
            storage_path: artifact.storage_path,
          })),
        }),
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to finalize staged uploads: ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      artifacts?: FinalizedTaskArtifactUpload[];
    };
    return data.artifacts ?? [];
  }

  async prepareTaskRunArtifactUploads(
    taskId: string,
    runId: string,
    artifacts: TaskArtifactUploadRequest[],
  ): Promise<PreparedTaskArtifactUpload[]> {
    if (!artifacts.length) {
      return [];
    }

    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/projects/${teamId}/tasks/${taskId}/runs/${runId}/artifacts/prepare_upload/`,
    );
    const response = await this.api.fetcher.fetch({
      method: "post",
      url,
      path: `/api/projects/${teamId}/tasks/${taskId}/runs/${runId}/artifacts/prepare_upload/`,
      overrides: {
        body: JSON.stringify({ artifacts }),
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to prepare uploads: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      artifacts?: PreparedTaskArtifactUpload[];
    };
    return data.artifacts ?? [];
  }

  async finalizeTaskRunArtifactUploads(
    taskId: string,
    runId: string,
    artifacts: PreparedTaskArtifactUpload[],
  ): Promise<FinalizedTaskArtifactUpload[]> {
    if (!artifacts.length) {
      return [];
    }

    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/projects/${teamId}/tasks/${taskId}/runs/${runId}/artifacts/finalize_upload/`,
    );
    const response = await this.api.fetcher.fetch({
      method: "post",
      url,
      path: `/api/projects/${teamId}/tasks/${taskId}/runs/${runId}/artifacts/finalize_upload/`,
      overrides: {
        body: JSON.stringify({
          artifacts: artifacts.map((artifact) => ({
            id: artifact.id,
            name: artifact.name,
            type: artifact.type,
            source: artifact.source,
            content_type: artifact.content_type,
            storage_path: artifact.storage_path,
          })),
        }),
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to finalize uploads: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      artifacts?: FinalizedTaskArtifactUpload[];
    };
    return data.artifacts ?? [];
  }

  async resumeRunInCloud(taskId: string, runId: string): Promise<TaskRun> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/projects/${teamId}/tasks/${taskId}/runs/${runId}/resume_in_cloud/`,
    );
    const response = await this.api.fetcher.fetch({
      method: "post",
      url,
      path: `/api/projects/${teamId}/tasks/${taskId}/runs/${runId}/resume_in_cloud/`,
    });

    if (!response.ok) {
      throw new Error(`Failed to resume run in cloud: ${response.statusText}`);
    }

    return (await response.json()) as TaskRun;
  }

  async listTaskRuns(taskId: string): Promise<TaskRun[]> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/projects/${teamId}/tasks/${taskId}/runs/`,
    );
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: `/api/projects/${teamId}/tasks/${taskId}/runs/`,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch task runs: ${response.statusText}`);
    }

    const data = (await response.json()) as { results?: TaskRun[] };
    return data.results ?? [];
  }

  async getTaskRun(taskId: string, runId: string): Promise<TaskRun> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/projects/${teamId}/tasks/${taskId}/runs/${runId}/`,
    );
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: `/api/projects/${teamId}/tasks/${taskId}/runs/${runId}/`,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch task run: ${response.statusText}`);
    }

    return (await response.json()) as TaskRun;
  }

  async createTaskRun(
    taskId: string,
    options?: CreateTaskRunOptions,
  ): Promise<TaskRun> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/projects/${teamId}/tasks/${taskId}/runs/`,
    );
    const response = await this.withCloudUsageLimitCheck(() =>
      this.api.fetcher.fetch({
        method: "post",
        url,
        path: `/api/projects/${teamId}/tasks/${taskId}/runs/`,
        overrides: {
          body: JSON.stringify({
            ...buildCloudRunRequestBody({
              ...options,
              mode: options?.mode ?? "background",
            }),
            environment: options?.environment ?? "local",
          }),
        },
      }),
    );

    if (!response.ok) {
      throw new Error(`Failed to create task run: ${response.statusText}`);
    }

    return (await response.json()) as TaskRun;
  }

  async startTaskRun(
    taskId: string,
    runId: string,
    options?: StartTaskRunOptions,
  ): Promise<Task> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/projects/${teamId}/tasks/${taskId}/runs/${runId}/start/`,
    );
    const response = await this.withCloudUsageLimitCheck(() =>
      this.api.fetcher.fetch({
        method: "post",
        url,
        path: `/api/projects/${teamId}/tasks/${taskId}/runs/${runId}/start/`,
        overrides: {
          body: JSON.stringify({
            pending_user_message: options?.pendingUserMessage,
            pending_user_artifact_ids: options?.pendingUserArtifactIds,
          }),
        },
      }),
    );

    if (!response.ok) {
      throw new Error(`Failed to start task run: ${response.statusText}`);
    }

    return (await response.json()) as Task;
  }

  async updateTaskRun(
    taskId: string,
    runId: string,
    updates: Partial<
      Pick<
        TaskRun,
        "status" | "branch" | "stage" | "error_message" | "output" | "state"
      >
    >,
  ): Promise<TaskRun> {
    const teamId = await this.getTeamId();
    const data = await this.api.patch(
      `/api/projects/{project_id}/tasks/{task_id}/runs/{id}/`,
      {
        path: {
          project_id: teamId.toString(),
          task_id: taskId,
          id: runId,
        },
        body: updates as Record<string, unknown>,
      },
    );
    return data as unknown as TaskRun;
  }

  /**
   * Append events to a task run's S3 log file
   */
  async appendTaskRunLog(
    taskId: string,
    runId: string,
    entries: StoredLogEntry[],
  ): Promise<void> {
    const teamId = await this.getTeamId();
    const url = `${this.api.baseUrl}/api/projects/${teamId}/tasks/${taskId}/runs/${runId}/append_log/`;
    const response = await this.api.fetcher.fetch({
      method: "post",
      url: new URL(url),
      path: url,
      overrides: {
        body: JSON.stringify({ entries }),
      },
    });
    if (!response.ok) {
      throw new Error(`Failed to append log: ${response.statusText}`);
    }
  }

  async getTaskRunSessionLogs(
    taskId: string,
    runId: string,
    options?: { limit?: number; after?: string },
  ): Promise<StoredLogEntry[]> {
    try {
      const teamId = await this.getTeamId();
      const url = new URL(
        `${this.api.baseUrl}/api/projects/${teamId}/tasks/${taskId}/runs/${runId}/session_logs/`,
      );
      url.searchParams.set("limit", String(options?.limit ?? 5000));
      if (options?.after) {
        url.searchParams.set("after", options.after);
      }
      const response = await this.api.fetcher.fetch({
        method: "get",
        url,
        path: `/api/projects/${teamId}/tasks/${taskId}/runs/${runId}/session_logs/`,
      });

      if (!response.ok) {
        log.warn(
          `Failed to fetch session logs: ${response.status} ${response.statusText}`,
        );
        return [];
      }

      return (await response.json()) as StoredLogEntry[];
    } catch (err) {
      log.warn("Failed to fetch task run session logs", err);
      return [];
    }
  }

  async getTaskLogs(taskId: string): Promise<StoredLogEntry[]> {
    try {
      const task = (await this.getTask(taskId)) as unknown as Task;
      const logUrl = task?.latest_run?.log_url;

      if (!logUrl) {
        return [];
      }

      const response = await fetch(logUrl);

      if (!response.ok) {
        log.warn(
          `Failed to fetch logs: ${response.status} ${response.statusText}`,
        );
        return [];
      }

      const content = await response.text();

      if (!content.trim()) {
        return [];
      }
      return content
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as StoredLogEntry);
    } catch (err) {
      log.warn("Failed to fetch task logs from latest run", err);
      return [];
    }
  }

  async getIntegrations() {
    const teamId = await this.getTeamId();
    return this.getIntegrationsForProject(teamId);
  }

  async getIntegrationsForProject(projectId: number) {
    const url = new URL(
      `${this.api.baseUrl}/api/environments/${projectId}/integrations/`,
    );
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: `/api/environments/${projectId}/integrations/`,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch integrations: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      results?: { kind: string; id: number | string; [key: string]: unknown }[];
    };
    return data.results ?? [];
  }

  async getGithubBranches(
    integrationId: string | number,
    repo: string,
  ): Promise<{ branches: string[]; defaultBranch: string | null }> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/environments/${teamId}/integrations/${integrationId}/github_branches/`,
    );
    url.searchParams.set("repo", repo);
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: `/api/environments/${teamId}/integrations/${integrationId}/github_branches/`,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch GitHub branches: ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      branches?: string[];
      results?: string[];
      default_branch?: string | null;
    };
    return {
      branches: data.branches ?? data.results ?? [],
      defaultBranch: data.default_branch ?? null,
    };
  }

  async getGithubBranchesPage(
    integrationId: string | number,
    repo: string,
    offset: number,
    limit: number,
    search?: string,
  ): Promise<{
    branches: string[];
    defaultBranch: string | null;
    hasMore: boolean;
  }> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/environments/${teamId}/integrations/${integrationId}/github_branches/`,
    );
    url.searchParams.set("repo", repo);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", String(limit));
    if (search?.trim()) {
      url.searchParams.set("search", search.trim());
    }
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: `/api/environments/${teamId}/integrations/${integrationId}/github_branches/`,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch GitHub branches: ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      branches?: string[];
      results?: string[];
      default_branch?: string | null;
      has_more?: boolean;
    };
    return {
      branches: data.branches ?? data.results ?? [],
      defaultBranch: data.default_branch ?? null,
      hasMore: data.has_more ?? false,
    };
  }

  async getGithubUserBranchesPage(
    installationId: string | number,
    repo: string,
    offset: number,
    limit: number,
    search?: string,
  ): Promise<{
    branches: string[];
    defaultBranch: string | null;
    hasMore: boolean;
  }> {
    const urlPath = `/api/users/@me/integrations/github/${installationId}/branches/`;
    const url = new URL(`${this.api.baseUrl}${urlPath}`);
    url.searchParams.set("repo", repo);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", String(limit));
    if (search?.trim()) {
      url.searchParams.set("search", search.trim());
    }
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: urlPath,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch personal GitHub branches: ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      branches?: string[];
      results?: string[];
      default_branch?: string | null;
      has_more?: boolean;
    };
    return {
      branches: data.branches ?? data.results ?? [],
      defaultBranch: data.default_branch ?? null,
      hasMore: data.has_more ?? false,
    };
  }

  async getGithubRepositories(
    integrationId: string | number,
  ): Promise<string[]> {
    const repositories: string[] = [];
    let offset = 0;

    while (true) {
      const page = await this.getGithubRepositoriesPage(
        integrationId,
        offset,
        500,
      );
      repositories.push(...page.repositories);

      if (!page.hasMore) {
        return repositories;
      }

      offset += page.repositories.length;
    }
  }

  async getGithubRepositoriesPage(
    integrationId: string | number,
    offset: number,
    limit: number,
    search?: string,
  ): Promise<{
    repositories: string[];
    hasMore: boolean;
  }> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/environments/${teamId}/integrations/${integrationId}/github_repos/`,
    );
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", String(limit));
    if (search?.trim()) {
      url.searchParams.set("search", search.trim());
    }
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: `/api/environments/${teamId}/integrations/${integrationId}/github_repos/`,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch GitHub repositories: ${response.statusText}`,
      );
    }

    const data = (await response.json()) as { has_more?: boolean };
    return {
      repositories: this.normalizeGithubRepositories(data),
      hasMore: data.has_more ?? false,
    };
  }

  async getGithubUserRepositories(
    installationId: string | number,
  ): Promise<string[]> {
    const repositories: string[] = [];
    let offset = 0;

    while (true) {
      const page = await this.getGithubUserRepositoriesPage(
        installationId,
        offset,
        500,
      );
      repositories.push(...page.repositories);

      if (!page.hasMore) {
        return repositories;
      }

      offset += page.repositories.length;
    }
  }

  async getGithubUserRepositoriesPage(
    installationId: string | number,
    offset: number,
    limit: number,
    search?: string,
  ): Promise<{
    repositories: string[];
    hasMore: boolean;
  }> {
    const urlPath = `/api/users/@me/integrations/github/${installationId}/repos/`;
    const url = new URL(`${this.api.baseUrl}${urlPath}`);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", String(limit));
    if (search?.trim()) {
      url.searchParams.set("search", search.trim());
    }
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: urlPath,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch personal GitHub repositories: ${response.statusText}`,
      );
    }

    const data = (await response.json()) as { has_more?: boolean };
    return {
      repositories: this.normalizeGithubRepositories(data),
      hasMore: data.has_more ?? false,
    };
  }

  async refreshGithubRepositories(
    integrationId: string | number,
  ): Promise<string[]> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/environments/${teamId}/integrations/${integrationId}/github_repos/refresh/`,
    );
    const response = await this.api.fetcher.fetch({
      method: "post",
      url,
      path: `/api/environments/${teamId}/integrations/${integrationId}/github_repos/refresh/`,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to refresh GitHub repositories: ${response.statusText}`,
      );
    }

    const data: unknown = await response.json();
    return this.normalizeGithubRepositories(data);
  }

  async refreshGithubUserRepositories(
    installationId: string | number,
  ): Promise<string[]> {
    const urlPath = `/api/users/@me/integrations/github/${installationId}/repos/refresh/`;
    const url = new URL(`${this.api.baseUrl}${urlPath}`);
    const response = await this.api.fetcher.fetch({
      method: "post",
      url,
      path: urlPath,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to refresh personal GitHub repositories: ${response.statusText}`,
      );
    }

    const data: unknown = await response.json();
    return this.normalizeGithubRepositories(data);
  }

  private normalizeGithubRepositories(data: unknown): string[] {
    const repos =
      (data as { repositories?: unknown[] }).repositories ??
      (data as { results?: unknown[] }).results ??
      (Array.isArray(data) ? data : []);

    return (repos as (string | { full_name?: string; name?: string })[]).map(
      (repo) => {
        if (typeof repo === "string") return repo;
        return (repo.full_name ?? repo.name ?? "").toLowerCase();
      },
    );
  }

  async getAgents() {
    const teamId = await this.getTeamId();
    const url = new URL(`${this.api.baseUrl}/api/projects/${teamId}/agents/`);
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: `/api/projects/${teamId}/agents/`,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch agents: ${response.statusText}`);
    }

    const data = (await response.json()) as { results?: unknown[] };
    return data.results ?? [];
  }

  async getUsers() {
    const data = (await this.api.get("/api/users/", {
      query: { limit: 1000 },
    })) as unknown as { results: Schemas.User[] } | Schemas.User[];
    return Array.isArray(data) ? data : (data.results ?? []);
  }

  async updateTeam(updates: {
    session_recording_opt_in?: boolean;
    autocapture_exceptions_opt_in?: boolean;
  }): Promise<Schemas.Team> {
    const teamId = await this.getTeamId();
    const url = new URL(`${this.api.baseUrl}/api/projects/${teamId}/`);
    const response = await this.api.fetcher.fetch({
      method: "patch",
      url,
      path: `/api/projects/${teamId}/`,
      overrides: {
        body: JSON.stringify(updates),
      },
    });

    if (!response.ok) {
      const responseText = await response.text();
      let detail = responseText;
      try {
        const parsed = JSON.parse(responseText) as
          | { detail?: string }
          | Record<string, unknown>;
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "detail" in parsed &&
          typeof parsed.detail === "string"
        ) {
          detail = parsed.detail;
        } else if (typeof parsed === "object" && parsed !== null) {
          detail = Object.entries(parsed)
            .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
            .join(", ");
        }
      } catch {
        // keep plain text fallback
      }

      throw new Error(
        `Failed to update team: ${detail || response.statusText}`,
      );
    }

    return (await response.json()) as Schemas.Team;
  }

  async getSignalReport(reportId: string): Promise<SignalReport | null> {
    const teamId = await this.getTeamId();
    const path = `/api/projects/${teamId}/signals/reports/${reportId}/`;
    const url = new URL(`${this.api.baseUrl}${path}`);

    try {
      const response = await this.api.fetcher.fetch({
        method: "get",
        url,
        path,
      });
      return (await response.json()) as SignalReport;
    } catch (error) {
      // The shared fetcher throws "Failed request: [<status>] <body>" for any
      // non-2xx. Treat missing / forbidden as "not available in the current
      // team" and surface other errors to the caller.
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("[404]") || msg.includes("[403]")) {
        return null;
      }
      throw error;
    }
  }

  async getSignalReports(
    params?: SignalReportsQueryParams,
  ): Promise<SignalReportsResponse> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/projects/${teamId}/signals/reports/`,
    );

    if (params?.limit != null) {
      url.searchParams.set("limit", String(params.limit));
    }
    if (params?.offset != null) {
      url.searchParams.set("offset", String(params.offset));
    }
    if (params?.status) {
      url.searchParams.set("status", params.status);
    }
    if (params?.ordering) {
      url.searchParams.set("ordering", params.ordering);
    }
    if (params?.source_product) {
      url.searchParams.set("source_product", params.source_product);
    }
    if (params?.suggested_reviewers) {
      url.searchParams.set("suggested_reviewers", params.suggested_reviewers);
    }
    if (params?.priority) {
      url.searchParams.set("priority", params.priority);
    }

    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: `/api/projects/${teamId}/signals/reports/`,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch signal reports: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      results?: SignalReport[];
      count?: number;
    };
    return {
      results: data.results ?? [],
      count: data.count ?? data.results?.length ?? 0,
    };
  }

  async getSignalProcessingState(): Promise<SignalProcessingStateResponse> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/projects/${teamId}/signals/processing/`,
    );
    const path = `/api/projects/${teamId}/signals/processing/`;

    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch signal processing state: ${response.statusText}`,
      );
    }

    const data = (await response.json()) as { paused_until?: string | null };
    return {
      paused_until:
        typeof data?.paused_until === "string" ? data.paused_until : null,
    };
  }

  async getAvailableSuggestedReviewers(
    query?: string,
  ): Promise<AvailableSuggestedReviewersResponse> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/projects/${teamId}/signals/reports/available_reviewers/`,
    );
    const path = `/api/projects/${teamId}/signals/reports/available_reviewers/`;

    if (query?.trim()) {
      url.searchParams.set("query", query.trim());
    }

    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch available suggested reviewers: ${response.statusText}`,
      );
    }

    return parseAvailableSuggestedReviewersPayload(await response.json());
  }

  async getSignalReportSignals(
    reportId: string,
  ): Promise<SignalReportSignalsResponse> {
    try {
      const teamId = await this.getTeamId();
      const url = new URL(
        `${this.api.baseUrl}/api/projects/${teamId}/signals/reports/${reportId}/signals/`,
      );
      const response = await this.api.fetcher.fetch({
        method: "get",
        url,
        path: `/api/projects/${teamId}/signals/reports/${reportId}/signals/`,
      });

      if (!response.ok) {
        log.warn("Signal report signals unavailable", {
          reportId,
          status: response.status,
        });
        return { report: null, signals: [] };
      }

      const data = (await response.json()) as {
        report?: SignalReport | null;
        signals?: Signal[];
      };
      return {
        report: data.report ?? null,
        signals: data.signals ?? [],
      };
    } catch (error) {
      log.warn("Failed to fetch signal report signals", { reportId, error });
      return { report: null, signals: [] };
    }
  }

  async getSignalReportArtefacts(
    reportId: string,
  ): Promise<SignalReportArtefactsResponse> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/projects/${teamId}/signals/reports/${reportId}/artefacts/`,
    );
    const path = `/api/projects/${teamId}/signals/reports/${reportId}/artefacts/`;

    try {
      const response = await this.api.fetcher.fetch({
        method: "get",
        url,
        path,
      });

      if (!response.ok) {
        const responseText = await response.text();
        const unavailableReason =
          response.status === 403
            ? "forbidden"
            : response.status === 404
              ? "not_found"
              : "request_failed";

        log.warn("Signal report artefacts unavailable", {
          teamId,
          reportId,
          status: response.status,
          statusText: response.statusText,
          body: responseText || undefined,
        });

        return { results: [], count: 0, unavailableReason };
      }

      const data = (await response.json()) as unknown;
      const parsed = parseSignalReportArtefactsPayload(data);

      if (parsed.unavailableReason) {
        log.warn("Signal report artefacts payload did not match schema", {
          teamId,
          reportId,
        });
      }

      return parsed;
    } catch (error) {
      log.warn("Failed to fetch signal report artefacts", {
        teamId,
        reportId,
        error,
      });
      return {
        results: [],
        count: 0,
        unavailableReason: "request_failed",
      };
    }
  }

  async updateSignalReportState(
    reportId: string,
    input:
      | {
          state: "potential";
          snooze_for?: number;
          reset_weight?: boolean;
          error?: string;
        }
      | {
          state: "suppressed";
          /** When omitted, the server suppresses without creating a dismissal artefact. */
          dismissal_reason?: DismissalReasonOptionValue;
          dismissal_note?: string;
          reset_weight?: boolean;
          error?: string;
        },
  ): Promise<SignalReport> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/projects/${teamId}/signals/reports/${reportId}/state/`,
    );
    const path = `/api/projects/${teamId}/signals/reports/${reportId}/state/`;

    const response = await this.api.fetcher.fetch({
      method: "post",
      url,
      path,
      overrides: {
        body: JSON.stringify(input),
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || "Failed to update signal report state");
    }

    return (await response.json()) as SignalReport;
  }

  async updateSignalReportArtefact(
    reportId: string,
    artefactId: string,
    content: SuggestedReviewerWriteEntry[],
  ): Promise<SuggestedReviewersArtefact> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/projects/${teamId}/signals/reports/${reportId}/artefacts/${artefactId}/`,
    );
    const path = `/api/projects/${teamId}/signals/reports/${reportId}/artefacts/${artefactId}/`;

    const response = await this.api.fetcher.fetch({
      method: "put",
      url,
      path,
      overrides: {
        body: JSON.stringify({ content }),
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || "Failed to update suggested reviewers");
    }

    const parsed = normalizeSignalReportArtefact(await response.json());
    if (!parsed || parsed.type !== "suggested_reviewers") {
      throw new Error("Unexpected response updating suggested reviewers");
    }
    return parsed as SuggestedReviewersArtefact;
  }

  async deleteSignalReport(reportId: string): Promise<{
    status: "deletion_started" | "already_running";
    report_id: string;
  }> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/projects/${teamId}/signals/reports/${reportId}/`,
    );
    const path = `/api/projects/${teamId}/signals/reports/${reportId}/`;

    const response = await this.api.fetcher.fetch({
      method: "delete",
      url,
      path,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || "Failed to delete signal report");
    }

    return (await response.json()) as {
      status: "deletion_started" | "already_running";
      report_id: string;
    };
  }

  async reingestSignalReport(reportId: string): Promise<{
    status: "reingestion_started" | "already_running";
    report_id: string;
  }> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/projects/${teamId}/signals/reports/${reportId}/reingest/`,
    );
    const path = `/api/projects/${teamId}/signals/reports/${reportId}/reingest/`;

    const response = await this.api.fetcher.fetch({
      method: "post",
      url,
      path,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || "Failed to reingest signal report");
    }

    return (await response.json()) as {
      status: "reingestion_started" | "already_running";
      report_id: string;
    };
  }

  async getSignalReportTasks(
    reportId: string,
    options?: { relationship?: SignalReportTask["relationship"] },
  ): Promise<SignalReportTask[]> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/projects/${teamId}/signals/reports/${reportId}/tasks/`,
    );
    if (options?.relationship) {
      url.searchParams.set("relationship", options.relationship);
    }
    const path = `/api/projects/${teamId}/signals/reports/${reportId}/tasks/`;

    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch signal report tasks: ${response.statusText}`,
      );
    }

    const data = (await response.json()) as { results?: SignalReportTask[] };
    return data.results ?? [];
  }

  async getSignalTeamConfig(): Promise<SignalTeamConfig> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/projects/${teamId}/signals/config/`,
    );
    const path = `/api/projects/${teamId}/signals/config/`;

    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch signal team config: ${response.statusText}`,
      );
    }

    return (await response.json()) as SignalTeamConfig;
  }

  async updateSignalTeamConfig(
    updates: Partial<{
      default_autostart_priority: string;
      default_slack_notification_channel: string | null;
      autostart_base_branches: Record<string, string>;
    }>,
  ): Promise<SignalTeamConfig> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/projects/${teamId}/signals/config/`,
    );
    const path = `/api/projects/${teamId}/signals/config/`;

    const response = await this.api.fetcher.fetch({
      method: "post",
      url,
      path,
      overrides: {
        body: JSON.stringify(updates),
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to update signal team config: ${response.statusText}`,
      );
    }

    return (await response.json()) as SignalTeamConfig;
  }

  async getSignalUserAutonomyConfig(): Promise<SignalUserAutonomyConfig | null> {
    const url = new URL(`${this.api.baseUrl}/api/users/@me/signal_autonomy/`);
    const path = "/api/users/@me/signal_autonomy/";

    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path,
    });

    return (await response.json()) as SignalUserAutonomyConfig;
  }

  async updateSignalUserAutonomyConfig(
    updates: Partial<{
      autostart_priority: string | null;
      slack_notification_integration_id: number | null;
      slack_notification_channel: string | null;
      slack_notification_min_priority: string | null;
    }>,
  ): Promise<SignalUserAutonomyConfig> {
    const url = new URL(`${this.api.baseUrl}/api/users/@me/signal_autonomy/`);
    const path = "/api/users/@me/signal_autonomy/";

    const response = await this.api.fetcher.fetch({
      method: "post",
      url,
      path,
      overrides: {
        body: JSON.stringify(updates),
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to update signal user autonomy config: ${response.statusText}`,
      );
    }
    return (await response.json()) as SignalUserAutonomyConfig;
  }

  async getSlackChannelsForIntegration(
    integrationId: number,
    params?: SlackChannelsQueryParams,
  ): Promise<SlackChannelsResponse> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/environments/${teamId}/integrations/${integrationId}/channels/`,
    );
    const search = params?.search?.trim();
    if (search) {
      url.searchParams.set("search", search);
    }
    if (params?.limit != null) {
      url.searchParams.set("limit", String(params.limit));
    }
    if (params?.offset != null) {
      url.searchParams.set("offset", String(params.offset));
    }
    if (params?.channelId) {
      url.searchParams.set("channel_id", params.channelId);
    }
    const path = `/api/environments/${teamId}/integrations/${integrationId}/channels/${url.search}`;

    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Slack channels: ${response.statusText}`);
    }
    return (await response.json()) as SlackChannelsResponse;
  }

  async deleteSignalUserAutonomyConfig(): Promise<void> {
    const url = new URL(`${this.api.baseUrl}/api/users/@me/signal_autonomy/`);
    const path = "/api/users/@me/signal_autonomy/";

    const response = await this.api.fetcher.fetch({
      method: "delete",
      url,
      path,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to delete signal user autonomy config: ${response.statusText}`,
      );
    }
  }

  async getMcpServers(): Promise<McpRecommendedServer[]> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/environments/${teamId}/mcp_servers/`,
    );
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: `/api/environments/${teamId}/mcp_servers/`,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch MCP servers: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      results?: McpRecommendedServer[];
    };
    return data.results ?? [];
  }

  async getMcpServerInstallations(): Promise<McpServerInstallation[]> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/environments/${teamId}/mcp_server_installations/`,
    );
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: `/api/environments/${teamId}/mcp_server_installations/`,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch MCP server installations: ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      results?: McpServerInstallation[];
    };
    return data.results ?? [];
  }

  async installCustomMcpServer(options: {
    name: string;
    url: string;
    auth_type: McpAuthType;
    api_key?: string;
    description?: string;
    client_id?: string;
    client_secret?: string;
    install_source?: "posthog" | "posthog-code";
    posthog_code_callback_url?: string;
  }): Promise<McpServerInstallation | Schemas.OAuthRedirectResponse> {
    const teamId = await this.getTeamId();
    const apiUrl = new URL(
      `${this.api.baseUrl}/api/environments/${teamId}/mcp_server_installations/install_custom/`,
    );
    const response = await this.api.fetcher.fetch({
      method: "post",
      url: apiUrl,
      path: `/api/environments/${teamId}/mcp_server_installations/install_custom/`,
      overrides: {
        body: JSON.stringify(options),
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        (errorData as { detail?: string }).detail ??
          `Failed to install MCP server: ${response.statusText}`,
      );
    }

    return (await response.json()) as
      | McpServerInstallation
      | Schemas.OAuthRedirectResponse;
  }

  async updateMcpServerInstallation(
    installationId: string,
    updates: {
      display_name?: string;
      description?: string;
      is_enabled?: boolean;
    },
  ): Promise<McpServerInstallation> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/environments/${teamId}/mcp_server_installations/${installationId}/`,
    );
    const response = await this.api.fetcher.fetch({
      method: "patch",
      url,
      path: `/api/environments/${teamId}/mcp_server_installations/${installationId}/`,
      overrides: {
        body: JSON.stringify(updates),
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        (errorData as { detail?: string }).detail ??
          `Failed to update MCP server: ${response.statusText}`,
      );
    }

    return (await response.json()) as McpServerInstallation;
  }

  async uninstallMcpServer(installationId: string): Promise<void> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/environments/${teamId}/mcp_server_installations/${installationId}/`,
    );
    const response = await this.api.fetcher.fetch({
      method: "delete",
      url,
      path: `/api/environments/${teamId}/mcp_server_installations/${installationId}/`,
    });

    if (!response.ok && response.status !== 204) {
      throw new Error(`Failed to uninstall MCP server: ${response.statusText}`);
    }
  }

  async installMcpTemplate(options: {
    template_id: string;
    api_key?: string;
    install_source?: "posthog" | "posthog-code";
    posthog_code_callback_url?: string;
  }): Promise<McpServerInstallation | Schemas.OAuthRedirectResponse> {
    const teamId = await this.getTeamId();
    const path = `/api/environments/${teamId}/mcp_server_installations/install_template/`;
    const response = await this.api.fetcher.fetch({
      method: "post",
      url: new URL(`${this.api.baseUrl}${path}`),
      path,
      overrides: { body: JSON.stringify(options) },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        (errorData as { detail?: string }).detail ??
          `Failed to install MCP template: ${response.statusText}`,
      );
    }

    return (await response.json()) as
      | McpServerInstallation
      | Schemas.OAuthRedirectResponse;
  }

  async authorizeMcpInstallation(options: {
    installation_id: string;
    install_source?: "posthog" | "posthog-code";
    posthog_code_callback_url?: string;
  }): Promise<Schemas.OAuthRedirectResponse> {
    const teamId = await this.getTeamId();
    const path = `/api/environments/${teamId}/mcp_server_installations/authorize/`;
    const url = new URL(`${this.api.baseUrl}${path}`);
    url.searchParams.set("installation_id", options.installation_id);
    if (options.install_source) {
      url.searchParams.set("install_source", options.install_source);
    }
    if (options.posthog_code_callback_url) {
      url.searchParams.set(
        "posthog_code_callback_url",
        options.posthog_code_callback_url,
      );
    }
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        (errorData as { detail?: string }).detail ??
          `Failed to authorize MCP installation: ${response.statusText}`,
      );
    }

    return (await response.json()) as Schemas.OAuthRedirectResponse;
  }

  async getMcpInstallationTools(
    installationId: string,
    options: { includeRemoved?: boolean } = {},
  ): Promise<McpInstallationTool[]> {
    const teamId = await this.getTeamId();
    const path = `/api/environments/${teamId}/mcp_server_installations/${installationId}/tools/`;
    const url = new URL(`${this.api.baseUrl}${path}`);
    if (options.includeRemoved) {
      url.searchParams.set("include_removed", "1");
    }
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch MCP installation tools: ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      results?: McpInstallationTool[];
    };
    return data.results ?? [];
  }

  async updateMcpToolApproval(
    installationId: string,
    toolName: string,
    approval_state: McpApprovalState,
  ): Promise<McpInstallationTool> {
    const teamId = await this.getTeamId();
    const path = `/api/environments/${teamId}/mcp_server_installations/${installationId}/tools/${encodeURIComponent(toolName)}/`;
    const response = await this.api.fetcher.fetch({
      method: "patch",
      url: new URL(`${this.api.baseUrl}${path}`),
      path,
      overrides: { body: JSON.stringify({ approval_state }) },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        (errorData as { detail?: string }).detail ??
          `Failed to update tool approval: ${response.statusText}`,
      );
    }

    return (await response.json()) as McpInstallationTool;
  }

  async refreshMcpInstallationTools(
    installationId: string,
  ): Promise<McpInstallationTool[]> {
    const teamId = await this.getTeamId();
    const path = `/api/environments/${teamId}/mcp_server_installations/${installationId}/tools/refresh/`;
    const response = await this.api.fetcher.fetch({
      method: "post",
      url: new URL(`${this.api.baseUrl}${path}`),
      path,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        (errorData as { detail?: string }).detail ??
          `Failed to refresh MCP tools: ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      results?: McpInstallationTool[];
    };
    return data.results ?? [];
  }

  async getMySeat(
    options: { best?: boolean } = { best: true },
  ): Promise<SeatData | null> {
    try {
      const url = new URL(`${this.api.baseUrl}/api/seats/me/`);
      url.searchParams.set("product_key", SEAT_PRODUCT_KEY);
      if (options.best) {
        url.searchParams.set("best", "true");
      }
      const response = await this.api.fetcher.fetch({
        method: "get",
        url,
        path: "/api/seats/me/",
      });
      return (await response.json()) as SeatData;
    } catch (error) {
      if (this.isFetcherStatusError(error, 404)) {
        return null;
      }
      throw error;
    }
  }

  async createSeat(planKey: string): Promise<SeatData> {
    try {
      const user = await this.getCurrentUser();
      const distinctId = user.distinct_id;
      if (!distinctId) {
        throw new Error("Cannot create seat: user has no distinct_id");
      }
      const url = new URL(`${this.api.baseUrl}/api/seats/`);
      const response = await this.api.fetcher.fetch({
        method: "post",
        url,
        path: "/api/seats/",
        overrides: {
          body: JSON.stringify({
            product_key: SEAT_PRODUCT_KEY,
            plan_key: planKey,
            user_distinct_id: distinctId,
          }),
        },
      });
      return (await response.json()) as SeatData;
    } catch (error) {
      this.throwSeatError(error);
    }
  }

  async upgradeSeat(planKey: string): Promise<SeatData> {
    try {
      const url = new URL(`${this.api.baseUrl}/api/seats/me/`);
      const response = await this.api.fetcher.fetch({
        method: "patch",
        url,
        path: "/api/seats/me/",
        overrides: {
          body: JSON.stringify({
            product_key: SEAT_PRODUCT_KEY,
            plan_key: planKey,
          }),
        },
      });
      return (await response.json()) as SeatData;
    } catch (error) {
      this.throwSeatError(error);
    }
  }

  async cancelSeat(): Promise<void> {
    try {
      const url = new URL(`${this.api.baseUrl}/api/seats/me/`);
      url.searchParams.set("product_key", SEAT_PRODUCT_KEY);
      await this.api.fetcher.fetch({
        method: "delete",
        url,
        path: "/api/seats/me/",
      });
    } catch (error) {
      if (this.isFetcherStatusError(error, 204)) {
        return;
      }
      this.throwSeatError(error);
    }
  }

  async reactivateSeat(): Promise<SeatData> {
    try {
      const url = new URL(`${this.api.baseUrl}/api/seats/me/reactivate/`);
      const response = await this.api.fetcher.fetch({
        method: "post",
        url,
        path: "/api/seats/me/reactivate/",
        overrides: {
          body: JSON.stringify({ product_key: SEAT_PRODUCT_KEY }),
        },
      });
      return (await response.json()) as SeatData;
    } catch (error) {
      this.throwSeatError(error);
    }
  }

  private isFetcherStatusError(error: unknown, status: number): boolean {
    return error instanceof Error && error.message.includes(`[${status}]`);
  }

  private parseFetcherError(error: unknown): {
    status: number;
    body: Record<string, unknown>;
  } | null {
    if (!(error instanceof Error)) return null;
    const match = error.message.match(/\[(\d+)\]\s*(.*)/);
    if (!match) return null;
    try {
      return {
        status: Number.parseInt(match[1], 10),
        body: JSON.parse(match[2]) as Record<string, unknown>,
      };
    } catch {
      return { status: Number.parseInt(match[1], 10), body: {} };
    }
  }

  /**
   * Run a cloud-run request, re-throwing a backend 429 usage-limit error as a
   * typed CloudUsageLimitError so the UI can show the upgrade prompt.
   */
  private async withCloudUsageLimitCheck<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const parsed = this.parseFetcherError(error);
      if (
        parsed &&
        parsed.status === 429 &&
        parsed.body.code === "usage_limit_exceeded"
      ) {
        const limitType = parsed.body.limit_type;
        throw new CloudUsageLimitError({
          limitType:
            limitType === "burst" || limitType === "sustained"
              ? limitType
              : null,
          resetAt:
            typeof parsed.body.reset_at === "string"
              ? parsed.body.reset_at
              : null,
          isPro: parsed.body.is_pro === true,
        });
      }
      throw error;
    }
  }

  private throwSeatError(error: unknown): never {
    const parsed = this.parseFetcherError(error);

    if (parsed) {
      if (
        parsed.status === 400 &&
        typeof parsed.body.redirect_url === "string"
      ) {
        throw new SeatSubscriptionRequiredError(parsed.body.redirect_url);
      }
      if (parsed.status === 402) {
        const message =
          typeof parsed.body.error === "string" ? parsed.body.error : undefined;
        throw new SeatPaymentFailedError(message);
      }
    }

    throw error;
  }

  /**
   * Check if a feature flag is enabled for the current project.
   * Returns true if the flag exists and is active, false otherwise.
   */
  async isFeatureFlagEnabled(flagKey: string): Promise<boolean> {
    try {
      const teamId = await this.getTeamId();
      const url = new URL(
        `${this.api.baseUrl}/api/projects/${teamId}/feature_flags/`,
      );
      url.searchParams.set("key", flagKey);

      const response = await this.api.fetcher.fetch({
        method: "get",
        url,
        path: `/api/projects/${teamId}/feature_flags/`,
      });

      if (!response.ok) {
        log.warn(`Failed to fetch feature flags: ${response.statusText}`);
        return false;
      }

      const data = (await response.json()) as {
        results?: { key: string; active: boolean }[];
      };
      const flags = data.results ?? [];
      const flag = flags.find(
        (f: { key: string; active: boolean }) => f.key === flagKey,
      );

      return flag?.active ?? false;
    } catch (error) {
      log.warn(`Error checking feature flag "${flagKey}":`, error);
      return false;
    }
  }

  // Sandbox Environments

  async listSandboxEnvironments(): Promise<SandboxEnvironment[]> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/projects/${teamId}/sandbox_environments/`,
    );
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: `/api/projects/${teamId}/sandbox_environments/`,
    });
    if (!response.ok) {
      throw new Error(
        `Failed to fetch sandbox environments: ${response.statusText}`,
      );
    }
    const data = (await response.json()) as {
      results?: SandboxEnvironment[];
    };
    return data.results ?? [];
  }

  async createSandboxEnvironment(
    input: SandboxEnvironmentInput,
  ): Promise<SandboxEnvironment> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/projects/${teamId}/sandbox_environments/`,
    );
    const response = await this.api.fetcher.fetch({
      method: "post",
      url,
      path: `/api/projects/${teamId}/sandbox_environments/`,
      overrides: {
        body: JSON.stringify(input),
      },
    });
    if (!response.ok) {
      throw new Error(
        `Failed to create sandbox environment: ${response.statusText}`,
      );
    }
    return (await response.json()) as SandboxEnvironment;
  }

  async updateSandboxEnvironment(
    id: string,
    input: Partial<SandboxEnvironmentInput>,
  ): Promise<SandboxEnvironment> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/projects/${teamId}/sandbox_environments/${id}/`,
    );
    const response = await this.api.fetcher.fetch({
      method: "patch",
      url,
      path: `/api/projects/${teamId}/sandbox_environments/${id}/`,
      overrides: {
        body: JSON.stringify(input),
      },
    });
    if (!response.ok) {
      throw new Error(
        `Failed to update sandbox environment: ${response.statusText}`,
      );
    }
    return (await response.json()) as SandboxEnvironment;
  }

  async deleteSandboxEnvironment(id: string): Promise<void> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/projects/${teamId}/sandbox_environments/${id}/`,
    );
    const response = await this.api.fetcher.fetch({
      method: "delete",
      url,
      path: `/api/projects/${teamId}/sandbox_environments/${id}/`,
    });
    if (!response.ok) {
      throw new Error(
        `Failed to delete sandbox environment: ${response.statusText}`,
      );
    }
  }

  /** Find an exported asset by session recording ID. */
  async findExportBySessionRecordingId(
    projectId: number,
    sessionRecordingId: string,
  ): Promise<number | null> {
    const urlPath = `/api/projects/${projectId}/exports/`;
    const url = new URL(`${this.api.baseUrl}${urlPath}`);
    url.searchParams.set("session_recording_id", sessionRecordingId);
    url.searchParams.set("export_format", "video/mp4");
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: urlPath,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      results?: Array<{ id: number; has_content: boolean }>;
    };
    const match = data.results?.find((e) => e.has_content);
    return match?.id ?? null;
  }

  /** Get the presigned content URL for an exported asset (e.g. rasterized recording). */
  async getExportContentUrl(
    projectId: number,
    exportId: number,
  ): Promise<string | null> {
    const urlPath = `/api/projects/${projectId}/exports/${exportId}/content/`;
    const url = new URL(`${this.api.baseUrl}${urlPath}`);
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: urlPath,
    });
    if (!response.ok) return null;
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }

  /**
   * Fetch the requesting user's personal LLM spend analysis. `dateFrom` / `dateTo`
   * accept absolute dates (`2026-04-23`) or relative strings (`-7d`, `-1m`), and
   * default to the last 30 days. When `product` is set the tool / model / trace
   * breakdowns are scoped to that `ai_product` (e.g. `posthog_code`); when omitted
   * they aggregate across every product.
   */
  async getPersonalSpendAnalysis(
    options: { dateFrom?: string; dateTo?: string; product?: string } = {},
  ): Promise<SpendAnalysisResponse> {
    const { dateFrom = "-30d", dateTo, product } = options;
    const urlPath = `/api/llm_analytics/@me/spend/`;
    const url = new URL(`${this.api.baseUrl}${urlPath}`);
    url.searchParams.set("date_from", dateFrom);
    if (dateTo) {
      url.searchParams.set("date_to", dateTo);
    }
    if (product) {
      url.searchParams.set("product", product);
    }
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: urlPath,
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch spend analysis: ${response.status}`);
    }
    return (await response.json()) as SpendAnalysisResponse;
  }

  /**
   * Lists the team's LLM skills (latest versions, no bodies).
   * Returns null when the feature is unavailable for this org (the
   * llm-analytics-skills flag gates the endpoint server-side with a 403).
   */
  async listLlmSkills(): Promise<LlmSkillListItem[] | null> {
    const teamId = await this.getTeamId();
    const urlPath = `/api/environments/${teamId}/llm_skills/`;
    const url = new URL(`${this.api.baseUrl}${urlPath}`);
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: urlPath,
    });
    if (response.status === 403) return null;
    if (!response.ok) {
      throw new Error(`Failed to fetch team skills: ${response.statusText}`);
    }
    const data = (await response.json()) as { results?: LlmSkillListItem[] };
    return data.results ?? [];
  }

  /** Fetches the latest version of a team skill, including body and file manifest. */
  async getLlmSkillByName(name: string): Promise<LlmSkill> {
    const teamId = await this.getTeamId();
    const urlPath = `/api/environments/${teamId}/llm_skills/name/${encodeURIComponent(name)}`;
    const url = new URL(`${this.api.baseUrl}${urlPath}`);
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: urlPath,
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch team skill: ${response.statusText}`);
    }
    return (await response.json()) as LlmSkill;
  }

  /** Creates a brand-new team skill (version 1). */
  async createLlmSkill(input: {
    name: string;
    description: string;
    body: string;
    files?: LlmSkillFileInput[];
  }): Promise<LlmSkill> {
    const teamId = await this.getTeamId();
    const urlPath = `/api/environments/${teamId}/llm_skills/`;
    const url = new URL(`${this.api.baseUrl}${urlPath}`);
    const response = await this.api.fetcher.fetch({
      method: "post",
      url,
      path: urlPath,
      overrides: { body: JSON.stringify(input) },
    });
    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as {
        detail?: string;
      };
      throw new Error(
        errorData.detail ??
          `Failed to create team skill: ${response.statusText}`,
      );
    }
    return (await response.json()) as LlmSkill;
  }

  /**
   * Publishes a new version of an existing team skill. `base_version` must
   * match the current latest version (409 otherwise).
   */
  async publishLlmSkillVersion(
    name: string,
    input: {
      body: string;
      description?: string;
      files?: LlmSkillFileInput[];
      base_version: number;
    },
  ): Promise<LlmSkill> {
    const teamId = await this.getTeamId();
    const urlPath = `/api/environments/${teamId}/llm_skills/name/${encodeURIComponent(name)}`;
    const url = new URL(`${this.api.baseUrl}${urlPath}`);
    const response = await this.api.fetcher.fetch({
      method: "patch",
      url,
      path: urlPath,
      overrides: { body: JSON.stringify(input) },
    });
    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as {
        detail?: string;
      };
      throw new Error(
        errorData.detail ??
          `Failed to publish team skill: ${response.statusText}`,
      );
    }
    return (await response.json()) as LlmSkill;
  }

  /** Fetches one companion file of a team skill. */
  async getLlmSkillFile(name: string, filePath: string): Promise<LlmSkillFile> {
    const teamId = await this.getTeamId();
    const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
    const urlPath = `/api/environments/${teamId}/llm_skills/name/${encodeURIComponent(name)}/files/${encodedPath}`;
    const url = new URL(`${this.api.baseUrl}${urlPath}`);
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: urlPath,
    });
    if (!response.ok) {
      throw new Error(
        `Failed to fetch team skill file: ${response.statusText}`,
      );
    }
    return (await response.json()) as LlmSkillFile;
  }
}
