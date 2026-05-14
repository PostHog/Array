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
  latest_run?: TaskRun;
}

export interface TaskRun {
  id: string;
  task: string;
  team: number;
  branch: string | null;
  stage?: string | null;
  environment?: "local" | "cloud";
  status: "started" | "in_progress" | "completed" | "failed";
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

export interface SessionNotification {
  update?: {
    sessionUpdate?: string;
    content?: { type: string; text: string };
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

export type WatchMissionEnvironment = "cloud" | "local" | "unknown";

export type WatchMissionStatus =
  | "idle"
  | "connecting"
  | "running"
  | "waiting_for_approval"
  | "blocked"
  | "failed"
  | "completed"
  | "stale";

export type WatchMissionChecklistStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export type WatchMissionTimelineKind =
  | "started"
  | "progress"
  | "tool"
  | "approval"
  | "blocked"
  | "failed"
  | "completed"
  | "handoff";

export type WatchMissionRisk = "low" | "medium" | "high" | "destructive";

export type WatchMissionActionType =
  | "approve"
  | "reject"
  | "stop"
  | "retry"
  | "open_phone"
  | "open_mac"
  | "view_diff";

export interface WatchMissionProgress {
  completed: number;
  running: number;
  pending: number;
  failed: number;
  total: number;
  /** 0...1 progress fraction for SwiftUI ProgressView/rings. */
  fraction: number;
}

export interface WatchMissionChecklistItem {
  id: string;
  title: string;
  subtitle?: string;
  status: WatchMissionChecklistStatus;
  priority?: string;
  depth?: number;
  kind?: "plan" | "agent" | "tool" | "approval" | "system";
  updatedAt?: number;
}

export interface WatchMissionTimelineItem {
  id: string;
  title: string;
  detail?: string;
  kind: WatchMissionTimelineKind;
  timestamp: number;
}

export interface WatchMissionApprovalOption {
  id: string;
  title: string;
  role: "approve" | "reject" | "neutral";
  destructive?: boolean;
}

export interface WatchMissionApproval {
  id: string;
  toolCallId: string;
  title: string;
  summary: string;
  detail?: string;
  risk: WatchMissionRisk;
  requestedAt: number;
  options: WatchMissionApprovalOption[];
  diffAvailable?: boolean;
}

export interface WatchMissionBlocker {
  title: string;
  detail?: string;
  kind: "error" | "approval" | "stale" | "offline" | "unknown";
}

export interface WatchMissionHandoff {
  phoneUrl: string;
  macUrl?: string;
  webUrl?: string;
}

export interface WatchMissionSnapshot {
  schemaVersion: 1;
  id: string;
  generatedAt: number;
  source: "mobile" | "desktop" | "cloud";
  taskId: string;
  taskRunId?: string;
  taskNumber?: number | null;
  slug?: string;
  title: string;
  repository?: string | null;
  branch?: string | null;
  environment: WatchMissionEnvironment;
  status: WatchMissionStatus;
  statusText: string;
  currentTask?: string;
  createdAt?: number;
  startedAt?: number;
  updatedAt?: number;
  completedAt?: number;
  elapsedSeconds: number;
  progress: WatchMissionProgress;
  checklist: WatchMissionChecklistItem[];
  timeline: WatchMissionTimelineItem[];
  approval?: WatchMissionApproval;
  blocker?: WatchMissionBlocker;
  lastError?: string | null;
  isStale: boolean;
  staleReason?: string;
  allowedActions: WatchMissionActionType[];
  handoff: WatchMissionHandoff;
}

export interface WatchMissionEnvelope {
  schemaVersion: 1;
  generatedAt: number;
  activeMissionId?: string;
  missions: WatchMissionSnapshot[];
}

interface WatchMissionCommandBase {
  id: string;
  taskId: string;
  taskRunId?: string;
}

export type WatchMissionCommand =
  | (WatchMissionCommandBase & {
      type: "approval_response";
      toolCallId: string;
      optionId: string;
      displayText: string;
      answers?: Record<string, string>;
      customInput?: string;
    })
  | (WatchMissionCommandBase & {
      type: "send_prompt";
      displayText: string;
    })
  | (WatchMissionCommandBase & {
      type: "debug_ping" | "debug_request_snapshot";
      displayText?: string;
    })
  | (WatchMissionCommandBase & {
      type: "stop" | "retry" | "open_phone" | "open_mac" | "view_diff";
      url?: string;
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

export interface CreateTaskOptions {
  description: string;
  title?: string;
  repository?: string;
  github_integration?: number;
}
