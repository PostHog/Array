import { z } from "zod";
import type { DismissalReasonOptionValue } from "./dismissal-reasons";
import type { StoredLogEntry } from "./session-events";

// Execution mode schema and type - shared between main and renderer
export const executionModeSchema = z.enum([
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
  "auto",
  "read-only",
  "full-access",
]);

import type { ExecutionMode } from "./exec-types";
export type { ExecutionMode };

// Effort level schema and type - shared between main and renderer
export const effortLevelSchema = z.enum([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
export type EffortLevel = z.infer<typeof effortLevelSchema>;

export interface UserBasic {
  id: number;
  uuid: string;
  distinct_id?: string | null;
  first_name?: string;
  last_name?: string;
  email: string;
  is_email_verified?: boolean | null;
}

export interface Task {
  id: string;
  task_number: number | null;
  slug: string;
  title: string;
  title_manually_set?: boolean;
  description: string;
  created_at: string;
  updated_at: string;
  created_by?: UserBasic | null;
  origin_product: string;
  repository?: string | null; // Format: "organization/repository" (e.g., "posthog/posthog-js")
  github_integration?: number | null;
  github_user_integration?: string | null;
  json_schema?: Record<string, unknown> | null;
  signal_report?: string | null;
  internal?: boolean;
  latest_run?: TaskRun;
}

export type TaskRunStatus =
  | "not_started"
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

export const TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;

export function isTerminalStatus(
  status: TaskRunStatus | string | null | undefined,
): boolean {
  return (
    status !== null &&
    status !== undefined &&
    TERMINAL_STATUSES.includes(status as (typeof TERMINAL_STATUSES)[number])
  );
}

export function isContentlessTask(task: {
  title?: string | null;
  description?: string | null;
}): boolean {
  return !task.title?.trim() && !task.description?.trim();
}

export interface TaskRun {
  id: string;
  task: string; // Task ID
  team: number;
  branch: string | null;
  runtime_adapter?: "claude" | "codex" | null;
  model?: string | null;
  reasoning_effort?: "low" | "medium" | "high" | "xhigh" | "max" | null;
  stage?: string | null; // Current stage (e.g., 'research', 'plan', 'build')
  environment?: "local" | "cloud";
  status: TaskRunStatus;
  log_url: string;
  error_message: string | null;
  output: Record<string, unknown> | null; // Structured output (PR URL, commit SHA, etc.)
  state: Record<string, unknown>; // Intermediate run state (defaults to {}, never null)
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export type NetworkAccessLevel = "trusted" | "full" | "custom";

export interface SandboxEnvironment {
  id: string;
  name: string;
  network_access_level: NetworkAccessLevel;
  allowed_domains: string[];
  include_default_domains: boolean;
  repositories: string[];
  has_environment_variables: boolean;
  private: boolean;
  effective_domains: string[];
  created_by?: UserBasic | null;
  created_at: string;
  updated_at: string;
}

export interface SandboxEnvironmentInput {
  name: string;
  network_access_level: NetworkAccessLevel;
  allowed_domains?: string[];
  include_default_domains?: boolean;
  repositories?: string[];
  environment_variables?: Record<string, string>;
  private?: boolean;
}

interface CloudTaskUpdateBase {
  taskId: string;
  runId: string;
}

export interface CloudTaskLogsUpdate extends CloudTaskUpdateBase {
  kind: "logs";
  newEntries: StoredLogEntry[];
  totalEntryCount: number;
}

export interface CloudTaskStatusUpdate extends CloudTaskUpdateBase {
  kind: "status";
  status?: TaskRunStatus;
  stage?: string | null;
  output?: Record<string, unknown> | null;
  errorMessage?: string | null;
  branch?: string | null;
}

export interface CloudTaskSnapshotUpdate extends CloudTaskUpdateBase {
  kind: "snapshot";
  newEntries: StoredLogEntry[];
  totalEntryCount: number;
  status?: TaskRunStatus;
  stage?: string | null;
  output?: Record<string, unknown> | null;
  errorMessage?: string | null;
  branch?: string | null;
}

export interface CloudTaskErrorUpdate extends CloudTaskUpdateBase {
  kind: "error";
  errorTitle: string;
  errorMessage: string;
  retryable: boolean;
}

export interface CloudPermissionOption {
  kind: string;
  optionId: string;
  name: string;
  _meta?: Record<string, unknown>;
}

export interface CloudTaskPermissionRequestUpdate extends CloudTaskUpdateBase {
  kind: "permission_request";
  requestId: string;
  toolCall: {
    toolCallId: string;
    title: string;
    kind: string;
    content?: unknown[];
    rawInput?: Record<string, unknown>;
    _meta?: Record<string, unknown>;
  };
  options: CloudPermissionOption[];
}

export type CloudTaskUpdatePayload =
  | CloudTaskLogsUpdate
  | CloudTaskStatusUpdate
  | CloudTaskSnapshotUpdate
  | CloudTaskErrorUpdate
  | CloudTaskPermissionRequestUpdate;

// Mention types for editors
type MentionType =
  | "file"
  | "folder"
  | "error"
  | "experiment"
  | "insight"
  | "feature_flag"
  | "generic";

export interface MentionItem {
  // File items
  path?: string;
  name?: string;
  kind?: "file" | "directory";
  // URL items
  url?: string;
  type?: MentionType;
  label?: string;
  id?: string;
  urlId?: string;
}

// Git file status types
import type { GitFileStatus } from "./git-types";
export type { GitFileStatus };

export type GitBusyOperation = "rebase" | "merge" | "cherry-pick" | "revert";

export type GitBusyState =
  | { busy: false }
  | { busy: true; operation: GitBusyOperation };

export interface ChangedFile {
  path: string;
  status: GitFileStatus;
  originalPath?: string; // For renames: the old path
  linesAdded?: number;
  linesRemoved?: number;
  staged?: boolean;
  patch?: string; // Unified diff patch from GitHub API
}

// External apps detection types
export type ExternalAppType =
  | "editor"
  | "terminal"
  | "file-manager"
  | "git-client";

export interface DetectedApplication {
  id: string; // "vscode", "cursor", "iterm"
  name: string; // "Visual Studio Code"
  type: ExternalAppType;
  path: string; // "/Applications/Visual Studio Code.app"
  command: string; // Launch command
  icon?: string; // Base64 data URL
}

import type { SignalReportStatus } from "./signal-types";
export type { SignalReportStatus };

/** Actionability priority from the researched report (actionability judgment artefact). */
export type SignalReportPriority = "P0" | "P1" | "P2" | "P3" | "P4";

/** Actionability choice from the researched report. */
export type SignalReportActionability =
  | "immediately_actionable"
  | "requires_human_input"
  | "not_actionable";

/**
 * One or more `SignalReportStatus` values joined by commas, e.g. `potential` or `potential,candidate,ready`.
 * This looks horrendous but it's superb, trust me bro.
 */
export type CommaSeparatedSignalReportStatuses =
  | SignalReportStatus
  | `${SignalReportStatus},${SignalReportStatus}`
  | `${SignalReportStatus},${SignalReportStatus},${SignalReportStatus}`
  | `${SignalReportStatus},${SignalReportStatus},${SignalReportStatus},${SignalReportStatus}`
  | `${SignalReportStatus},${SignalReportStatus},${SignalReportStatus},${SignalReportStatus},${SignalReportStatus}`;

export interface SignalReport {
  id: string;
  title: string | null;
  summary: string | null;
  status: SignalReportStatus;
  total_weight: number;
  signal_count: number;
  signals_at_run?: number;
  created_at: string;
  updated_at: string;
  artefact_count: number;
  /** P0–P4 from priority judgment when the report is researched */
  priority?: SignalReportPriority | null;
  /** Actionability choice from the actionability judgment artefact. */
  actionability?: SignalReportActionability | null;
  /** Whether the issue appears already fixed, from the actionability judgment artefact. */
  already_addressed?: boolean | null;
  /** Reason code from the latest dismissal artefact, set when the report was suppressed. */
  dismissal_reason?: DismissalReasonOptionValue | null;
  /** Free-form note captured alongside the dismissal reason. */
  dismissal_note?: string | null;
  /** Whether the current user is a suggested reviewer for this report (server-annotated). */
  is_suggested_reviewer?: boolean;
  /** Distinct source products contributing signals to this report. */
  source_products?: string[];
  /** PR URL from the latest implementation task run, if available. */
  implementation_pr_url?: string | null;
}

export interface SignalReportArtefactContent {
  session_id: string;
  start_time: string;
  end_time: string;
  distinct_id: string;
  content: string;
  distance_to_centroid: number | null;
}

/**
 * Fields shared by every artefact row. `created_by` / `task_id` carry attribution:
 * at most one is set — `created_by` for user writes, `task_id` for agent writes,
 * neither for system (pipeline) writes.
 */
export interface SignalReportArtefactBase {
  id: string;
  created_at: string;
  updated_at?: string | null;
  /** User the artefact is attributed to, when a user produced it. */
  created_by?: UserBasic | null;
  /** Task the artefact is attributed to, when an agent produced it. */
  task_id?: string | null;
  /**
   * True when the row's content did not match its type's expected shape and was
   * normalized to a plain text preview instead — the entry still renders rather
   * than silently vanishing from the activity log.
   */
  degraded?: boolean;
}

export interface SignalReportArtefact extends SignalReportArtefactBase {
  type: string;
  content: SignalReportArtefactContent;
}

/** Artefact with `type: "priority_judgment"` — priority assessment from the agentic report. */
export interface PriorityJudgmentArtefact extends SignalReportArtefactBase {
  type: "priority_judgment";
  content: PriorityJudgmentContent;
}

export interface PriorityJudgmentContent {
  explanation: string;
  priority: SignalReportPriority;
}

/** Artefact with `type: "actionability_judgment"` — actionability assessment from the agentic report. */
export interface ActionabilityJudgmentArtefact
  extends SignalReportArtefactBase {
  type: "actionability_judgment";
  content: ActionabilityJudgmentContent;
}

export interface ActionabilityJudgmentContent {
  explanation: string;
  actionability: SignalReportActionability;
  already_addressed: boolean;
}

/** Artefact with `type: "safety_judgment"` — the prompt-injection safety verdict for the report. */
export interface SafetyJudgmentArtefact extends SignalReportArtefactBase {
  type: "safety_judgment";
  content: SafetyJudgmentContent;
}

export interface SafetyJudgmentContent {
  /** True when the report's signals are judged safe to act on. */
  choice: boolean;
  /** Why the report was judged unsafe; null when safe. */
  explanation: string | null;
}

/** Artefact with `type: "signal_finding"` — per-signal research finding from the agentic report. */
export interface SignalFindingArtefact extends SignalReportArtefactBase {
  type: "signal_finding";
  content: SignalFindingContent;
}

export interface SignalFindingContent {
  signal_id: string;
  relevant_code_paths: string[];
  relevant_commit_hashes: Record<string, string>;
  data_queried: string;
  verified: boolean;
}

/** Artefact with `type: "repo_selection"` - selected repository for the report run. */
export interface RepoSelectionArtefact extends SignalReportArtefactBase {
  type: "repo_selection";
  content: RepoSelectionContent;
}

export interface RepoSelectionContent {
  repository: string | null;
  reason: string;
}

/** Artefact with `type: "suggested_reviewers"` — content is an enriched reviewer list. */
export interface SuggestedReviewersArtefact extends SignalReportArtefactBase {
  type: "suggested_reviewers";
  content: SuggestedReviewer[];
}

/** Artefact with `type: "dismissal"` — captures the user's rationale when suppressing a report. */
export interface DismissalArtefact extends SignalReportArtefactBase {
  type: "dismissal";
  content: DismissalContent;
}

export interface DismissalContent {
  reason: DismissalReasonOptionValue;
  /** Optional free-form detail provided alongside the reason. */
  note: string;
  /** PostHog numeric user id of the dismisser, when available. */
  user_id: number | null;
  /** PostHog UUID of the dismisser, when available. */
  user_uuid: string | null;
}

// ── Log artefacts ────────────────────────────────────────────────────────────
// Append-but-deletable "work log" entries that accumulate on a report. Distinct
// from the status artefacts above (judgments, reviewers) which are latest-wins.
// Content shapes mirror products/signals/backend/artefact_schemas.py.

/** Artefact with `type: "code_reference"` — a contiguous span of source lines. */
export interface CodeReferenceArtefact extends SignalReportArtefactBase {
  type: "code_reference";
  content: CodeReferenceContent;
}

export interface CodeReferenceContent {
  file_path: string;
  start_line: number;
  end_line: number;
  contents: string;
  relevance_note: string;
}

/** Artefact with `type: "line_reference"` — a single source line callout (a point). */
export interface LineReferenceArtefact extends SignalReportArtefactBase {
  type: "line_reference";
  content: LineReferenceContent;
}

export interface LineReferenceContent {
  file_path: string;
  line: number;
  note: string;
  /** The exact source text of the referenced line, if available. */
  contents?: string | null;
}

/** Artefact with `type: "commit"` — one commit pushed in relation to the report. */
export interface CommitArtefact extends SignalReportArtefactBase {
  type: "commit";
  content: CommitContent;
}

export interface CommitContent {
  repository: string;
  branch: string;
  commit_sha: string;
  message: string;
  note?: string | null;
}

/** Artefact with `type: "task_run"` — a reference to a `tasks.Task` run for the report. */
export interface TaskRunArtefact extends SignalReportArtefactBase {
  type: "task_run";
  content: TaskRunArtefactContent;
}

export interface TaskRunArtefactContent {
  task_id: string;
  run_id?: string | null;
  /**
   * Product that ran the task — `signals` for the built-in pipeline, or a custom agent's
   * product identifier (mirrors backend TaskRunArtefact).
   */
  product: string;
  /**
   * Task type within the product — e.g. `research` / `implementation` / `repo_selection` for the
   * signals pipeline, or a custom agent's type identifier.
   */
  type: string;
}

/** Artefact with `type: "note"` — a free-form note authored by an agent or by code. */
export interface NoteArtefact extends SignalReportArtefactBase {
  type: "note";
  content: NoteContent;
}

export interface NoteContent {
  note: string;
  author?: string | null;
}

/** Response from the `commit` artefact diff endpoint — the commit rendered against its parent. */
export interface CommitDiffResponse {
  /** Unified diff (patch) text introduced by the commit. */
  diff: string;
  /** True when the diff was too large to return in full and has been truncated. */
  truncated: boolean;
}

export interface SuggestedReviewerCommit {
  sha: string;
  url: string;
  reason: string;
}

export interface SuggestedReviewerUser {
  id: number;
  uuid: string;
  email: string;
  first_name: string;
  last_name: string;
}

import type { AvailableSuggestedReviewer } from "./inbox-types";
export type { AvailableSuggestedReviewer };

export interface SuggestedReviewer {
  github_login: string;
  github_name: string | null;
  relevant_commits: SuggestedReviewerCommit[];
  user: SuggestedReviewerUser | null;
}

export interface SuggestedReviewerWriteEntry {
  github_login?: string;
  user_uuid?: string;
  github_name?: string;
}

interface MatchedSignalMetadata {
  parent_signal_id: string;
  match_query: string;
  reason: string;
}

interface NoMatchSignalMetadata {
  reason: string;
  rejected_signal_ids: string[];
}

export type SignalMatchMetadata = MatchedSignalMetadata | NoMatchSignalMetadata;

export interface Signal {
  signal_id: string;
  content: string;
  source_product: string;
  source_type: string;
  source_id: string;
  weight: number;
  timestamp: string;
  extra: Record<string, unknown>;
  match_metadata?: SignalMatchMetadata | null;
}

export interface SignalReportsResponse {
  results: SignalReport[];
  count: number;
}

export interface SignalProcessingStateResponse {
  paused_until: string | null;
}

export interface AvailableSuggestedReviewersResponse {
  results: AvailableSuggestedReviewer[];
  count: number;
}

export interface SignalReportSignalsResponse {
  report: SignalReport | null;
  signals: Signal[];
}

/** Any artefact returned by the report `artefacts/` endpoint, discriminated on `type`. */
export type AnySignalReportArtefact =
  | SignalReportArtefact
  | PriorityJudgmentArtefact
  | ActionabilityJudgmentArtefact
  | SafetyJudgmentArtefact
  | SignalFindingArtefact
  | RepoSelectionArtefact
  | SuggestedReviewersArtefact
  | DismissalArtefact
  | CodeReferenceArtefact
  | LineReferenceArtefact
  | CommitArtefact
  | TaskRunArtefact
  | NoteArtefact;

export interface SignalReportArtefactsResponse {
  results: AnySignalReportArtefact[];
  count: number;
  unavailableReason?:
    | "forbidden"
    | "not_found"
    | "invalid_payload"
    | "request_failed";
}

import type { SignalReportOrderingField } from "./signal-types";
export type { SignalReportOrderingField };

export interface SignalReportsQueryParams {
  limit?: number;
  offset?: number;
  status?: CommaSeparatedSignalReportStatuses | string;
  /**
   * Comma-separated sort keys (prefix `-` for descending). `status` is semantic stage
   * rank (not lexicographic `status` column order). Also: `signal_count`, `total_weight`,
   * `created_at`, `updated_at`, `id`. Example: `status,-total_weight`.
   */
  ordering?: string;
  /** Comma-separated source products — only returns reports with signals from these sources. */
  source_product?: string;
  /** Comma-separated PostHog user UUIDs — only returns reports with these suggested reviewers. */
  suggested_reviewers?: string;
  /** Comma-separated `P0`–`P4` priorities — only returns reports with one of these priorities. */
  priority?: string;
  /**
   * Filter by whether a shipped implementation pull request exists. `true` keeps only PR
   * reports, `false` only non-PR reports. Pair with `limit: 1` to count PR reports cheaply.
   */
  has_implementation_pr?: boolean;
}

export interface SignalTeamConfig {
  id: string;
  default_autostart_priority: SignalReportPriority;
  /** Team-wide default `channel_id|#channel-name` target for inbox notifications. `null` = no team default. */
  default_slack_notification_channel?: string | null;
  autostart_base_branches?: Record<string, string> | null;
  created_at: string;
  updated_at: string;
}

export interface SignalUserAutonomyConfig {
  id?: string;
  autostart_priority: SignalReportPriority | null;
  /** ID of the team-scoped Slack `Integration` row used to deliver inbox-item notifications. */
  slack_notification_integration_id?: number | null;
  /** `channel_id|#channel-name` target — same convention used by Insight Alerts. */
  slack_notification_channel?: string | null;
  /** Minimum priority that triggers a notification (P0 highest). `null` = every priority. */
  slack_notification_min_priority?: SignalReportPriority | null;
  created_at?: string;
  updated_at?: string;
}

export interface SlackChannelOption {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
  is_ext_shared: boolean;
  is_private_without_access: boolean;
}

export interface SlackChannelsResponse {
  channels: SlackChannelOption[];
  lastRefreshedAt?: string;
  has_more?: boolean;
}

export interface SlackChannelsQueryParams {
  search?: string;
  limit?: number;
  offset?: number;
  channelId?: string;
}

export type {
  NewTaskLinkPayload,
  NewTaskSharedParams,
} from "./deep-links";
