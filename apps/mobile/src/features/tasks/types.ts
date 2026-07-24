import type {
  CloudPermissionOption,
  CloudTaskPermissionRequestUpdate,
  StoredLogEntry as SharedStoredLogEntry,
  TaskRunStatus,
} from "@posthog/shared";

export interface MobileStoredLogEntry extends SharedStoredLogEntry {
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

export interface CloudPermissionResponseSelection {
  optionId: string;
  displayText: string;
  customInput?: string;
  answers?: Record<string, string>;
}

export interface CloudPendingPermissionRequest {
  requestId: string;
  toolCall: CloudTaskPermissionRequestUpdate["toolCall"];
  options: CloudPermissionOption[];
  response?: CloudPermissionResponseSelection;
}

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
  toolCall: CloudTaskPermissionRequestUpdate["toolCall"];
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

/**
 * A user-scoped GitHub integration from `/api/users/@me/integrations/`.
 * `id` is the PostHog `UserIntegration` UUID (used as `github_user_integration`
 * on task creation); `installation_id` is the numeric GitHub App installation id
 * (used to fetch repos and as the numeric key in `RepositoryOption`).
 */
export interface UserGithubIntegration {
  id: string;
  kind: string;
  installation_id: string;
  account?: {
    name?: string;
    type?: string;
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

export interface CreateTaskOptions {
  description: string;
  title?: string;
  repository?: string;
  github_integration?: number;
  /** User-scoped GitHub integration UUID (UserIntegration pk) for user-authored
   *  cloud runs. Preferred over `github_integration` for interactive tasks. */
  github_user_integration?: string;
}
