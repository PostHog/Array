export interface Task {
  id: string;
  task_number: number | null;
  slug: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
  origin_product: string;
  repository?: string | null;
  github_integration?: number | null;
  internal?: boolean;
  latest_run?: TaskRun;
}

export interface TaskAutomation {
  id: string;
  name: string;
  prompt: string;
  repository: string;
  github_integration?: number | null;
  cron_expression: string;
  timezone?: string | null;
  template_id?: string | null;
  enabled: boolean;
  last_run_at: string | null;
  last_run_status: string | null;
  last_task_id: string | null;
  last_task_run_id: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export type TaskRunStatus =
  | "not_started"
  | "queued"
  | "started"
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

export interface TaskRun {
  id: string;
  task: string;
  team: number;
  branch: string | null;
  stage?: string | null;
  environment?: "local" | "cloud";
  status: TaskRunStatus;
  log_url: string;
  error_message: string | null;
  output: Record<string, unknown> | null;
  state: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface StoredLogEntry {
  type: string;
  timestamp?: string;
  notification?: {
    id?: number;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: unknown;
  };
  direction?: "client" | "agent";
}

export interface SessionNotificationAttachment {
  kind: "image" | "document";
  uri: string;
  fileName: string;
  mimeType?: string;
}

export interface SessionNotification {
  update?: {
    sessionUpdate?: string;
    content?: { type: string; text: string };
    // Sidecar carrying user-uploaded attachments on user_message_chunk events.
    // The wire format embeds the bytes themselves in a separate serialized
    // cloud-prompt payload sent to the agent; this field exists only so the
    // local feed can render the attachments alongside the echoed text.
    attachments?: SessionNotificationAttachment[];
    title?: string;
    toolCallId?: string;
    status?: "pending" | "in_progress" | "completed" | "failed" | null;
    rawInput?: Record<string, unknown>;
    rawOutput?: unknown;
    entries?: PlanEntry[];
    _meta?: {
      claudeCode?: {
        toolName?: string;
        parentToolCallId?: string;
      };
    };
  };
}

export interface PlanEntry {
  content: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  priority: string;
}

export type WatchTaskEnvironment = "cloud" | "local" | "unknown";

export type WatchTaskStatus =
  | "idle"
  | "connecting"
  | "running"
  | "waiting_for_approval"
  | "blocked"
  | "failed"
  | "completed"
  | "stale";

export type WatchTaskChecklistStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export type WatchTaskTimelineKind =
  | "started"
  | "progress"
  | "tool"
  | "approval"
  | "blocked"
  | "failed"
  | "completed"
  | "handoff";

export type WatchTaskRisk = "low" | "medium" | "high" | "destructive";

export type WatchTaskActionType =
  | "approve"
  | "reject"
  | "stop"
  | "retry"
  | "open_phone"
  | "open_mac"
  | "view_diff";

export type WatchInboxReportStatus =
  | "potential"
  | "candidate"
  | "in_progress"
  | "ready"
  | "failed"
  | "pending_input"
  | "suppressed"
  | "deleted";

export type WatchInboxReportPriority = "P0" | "P1" | "P2" | "P3" | "P4";

export type WatchInboxReportActionability =
  | "immediately_actionable"
  | "requires_human_input"
  | "not_actionable";

export interface WatchInboxReviewer {
  uuid: string;
  name: string;
  email?: string;
  githubLogin?: string;
  isMe?: boolean;
}

export interface WatchInboxSuggestedReviewer {
  uuid?: string;
  name: string;
  githubLogin: string;
  isMe?: boolean;
}

export type WatchInboxReportAction =
  | "dismiss"
  | "start_task"
  | "implement_as_task"
  | "open_phone";

export interface WatchInboxReportSnapshot {
  schemaVersion: 1;
  id: string;
  title: string;
  summary?: string;
  status: WatchInboxReportStatus;
  statusText: string;
  priority?: WatchInboxReportPriority | null;
  actionability?: WatchInboxReportActionability | null;
  actionabilityText?: string;
  alreadyAddressed?: boolean | null;
  isSuggestedReviewer?: boolean;
  suggestedReviewerUuids: string[];
  suggestedReviewers: WatchInboxSuggestedReviewer[];
  sourceProducts: string[];
  signalCount: number;
  totalWeight: number;
  createdAt?: number;
  updatedAt?: number;
  implementationPrUrl?: string | null;
  repository?: string | null;
  allowedActions: WatchInboxReportAction[];
  handoff: WatchTaskHandoff;
}

export interface WatchTaskProgress {
  completed: number;
  running: number;
  pending: number;
  failed: number;
  total: number;
  /** 0...1 progress fraction for SwiftUI ProgressView/rings. */
  fraction: number;
}

export interface WatchTaskChecklistItem {
  id: string;
  title: string;
  subtitle?: string;
  status: WatchTaskChecklistStatus;
  priority?: string;
  depth?: number;
  kind?: "plan" | "agent" | "tool" | "approval" | "system";
  updatedAt?: number;
}

export interface WatchTaskTimelineItem {
  id: string;
  title: string;
  detail?: string;
  kind: WatchTaskTimelineKind;
  timestamp: number;
}

export interface WatchTaskApprovalOption {
  id: string;
  title: string;
  role: "approve" | "reject" | "neutral";
  destructive?: boolean;
}

export interface WatchTaskApproval {
  id: string;
  toolCallId: string;
  title: string;
  summary: string;
  detail?: string;
  risk: WatchTaskRisk;
  requestedAt: number;
  options: WatchTaskApprovalOption[];
  diffAvailable?: boolean;
}

export interface WatchTaskBlocker {
  title: string;
  detail?: string;
  kind: "error" | "approval" | "stale" | "offline" | "unknown";
}

export interface WatchTaskHandoff {
  phoneUrl: string;
  macUrl?: string;
  webUrl?: string;
}

export interface WatchTaskSnapshot {
  schemaVersion: 1;
  id: string;
  generatedAt: number;
  source: "mobile" | "desktop" | "cloud";
  taskId: string;
  taskRunId?: string;
  taskNumber?: number | null;
  slug?: string;
  title: string;
  subtitle?: string;
  repository?: string | null;
  branch?: string | null;
  internal?: boolean;
  isArchived?: boolean;
  environment: WatchTaskEnvironment;
  status: WatchTaskStatus;
  statusText: string;
  currentTask?: string;
  createdAt?: number;
  startedAt?: number;
  updatedAt?: number;
  completedAt?: number;
  elapsedSeconds: number;
  progress: WatchTaskProgress;
  checklist: WatchTaskChecklistItem[];
  timeline: WatchTaskTimelineItem[];
  approval?: WatchTaskApproval;
  blocker?: WatchTaskBlocker;
  lastError?: string | null;
  isStale: boolean;
  staleReason?: string;
  allowedActions: WatchTaskActionType[];
  handoff: WatchTaskHandoff;
}

export interface WatchTaskEnvelope {
  schemaVersion: 1;
  generatedAt: number;
  isAuthenticated: boolean;
  activeTaskId?: string;
  tasks: WatchTaskSnapshot[];
  inboxReports?: WatchInboxReportSnapshot[];
  inboxReviewers?: WatchInboxReviewer[];
}

interface WatchTaskCommandBase {
  id: string;
  taskId: string;
  taskRunId?: string;
}

export type WatchTaskCommand =
  | (WatchTaskCommandBase & {
      type: "approval_response";
      toolCallId: string;
      optionId: string;
      displayText: string;
      answers?: Record<string, string>;
      customInput?: string;
    })
  | (WatchTaskCommandBase & {
      type: "send_prompt";
      displayText: string;
    })
  | (WatchTaskCommandBase & {
      type: "debug_ping" | "debug_request_snapshot" | "request_snapshot";
      displayText?: string;
    })
  | (WatchTaskCommandBase & {
      type:
        | "stop"
        | "retry"
        | "open_phone"
        | "open_mac"
        | "view_diff"
        | "archive"
        | "restore"
        | "create_task"
        | "open_report"
        | "dismiss_report"
        | "start_report_task";
      url?: string;
      reportId?: string;
      optionId?: string;
      displayText?: string;
      customInput?: string;
    });

export interface AcpMessage {
  type: "acp_message";
  direction: "client" | "agent";
  ts: number;
  message: unknown;
}

export interface SessionUpdateEvent {
  type: "session_update";
  ts: number;
  notification: SessionNotification;
}

export type SessionEvent = AcpMessage | SessionUpdateEvent;

export interface CloudPermissionOption {
  kind: string;
  optionId: string;
  name: string;
  _meta?: Record<string, unknown>;
}

export interface CloudPermissionToolCall {
  toolCallId: string;
  title: string;
  kind: string;
  content?: unknown[];
  rawInput?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
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

export interface CloudTaskPermissionRequestUpdate extends CloudTaskUpdateBase {
  kind: "permission_request";
  requestId: string;
  toolCall: CloudPermissionToolCall;
  options: CloudPermissionOption[];
}

export type CloudTaskUpdatePayload =
  | CloudTaskLogsUpdate
  | CloudTaskStatusUpdate
  | CloudTaskSnapshotUpdate
  | CloudTaskErrorUpdate
  | CloudTaskPermissionRequestUpdate;

export interface TaskRunStateEvent {
  type: "task_run_state";
  status?: TaskRunStatus;
  stage?: string | null;
  output?: Record<string, unknown> | null;
  error_message?: string | null;
  branch?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
}

export interface PermissionRequestEventData {
  type: "permission_request";
  requestId: string;
  toolCall: CloudPermissionToolCall;
  options: CloudPermissionOption[];
}

export interface SseErrorEventData {
  error: string;
}

export function isTaskRunStateEvent(data: unknown): data is TaskRunStateEvent {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: string }).type === "task_run_state"
  );
}

export function isPermissionRequestEvent(
  data: unknown,
): data is PermissionRequestEventData {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: string }).type === "permission_request" &&
    typeof (data as { requestId?: string }).requestId === "string"
  );
}

export function isKeepaliveEvent(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: string }).type === "keepalive"
  );
}

export function isSseErrorEvent(data: unknown): data is SseErrorEventData {
  return (
    typeof data === "object" &&
    data !== null &&
    "error" in data &&
    typeof (data as SseErrorEventData).error === "string"
  );
}

export interface Integration {
  id: number;
  kind: string;
  display_name?: string;
  config?: {
    account?: {
      login?: string;
    };
  };
}

export interface RepositoryOption {
  integrationId: number;
  integrationLabel: string;
  repository: string;
}

export interface RepositorySelection {
  integrationId: number | null;
  repository: string | null;
}

export type AutomationTemplateAudience = "developer" | "pm" | "executive";

export interface AutomationTemplate {
  id: string;
  name: string;
  description: string;
  audience: AutomationTemplateAudience;
  audienceLabel: string;
  categoryLabel: string;
  prompt: string;
  suggestedName: string;
  cron_expression: string;
  enabled: boolean;
  requiresRepository: boolean;
  hero?: boolean;
}

export interface AutomationTemplateInitialValues {
  name: string;
  prompt: string;
  cron_expression: string;
  enabled: boolean;
  template_id: string;
}

export interface CreateTaskOptions {
  description: string;
  title?: string;
  repository?: string;
  github_integration?: number;
}

export interface CreateTaskAutomationOptions {
  name: string;
  prompt: string;
  repository: string;
  github_integration?: number | null;
  cron_expression: string;
  timezone: string;
  enabled?: boolean;
  template_id?: string | null;
}

export interface UpdateTaskAutomationOptions {
  name?: string;
  prompt?: string;
  repository?: string;
  github_integration?: number | null;
  cron_expression?: string;
  timezone?: string;
  enabled?: boolean;
  template_id?: string | null;
}
