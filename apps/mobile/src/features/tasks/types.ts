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

export interface TaskRun {
  id: string;
  task: string;
  team: number;
  branch: string | null;
  stage?: string | null;
  environment?: "local" | "cloud";
  status:
    | "not_started"
    | "queued"
    | "started"
    | "in_progress"
    | "completed"
    | "failed"
    | "cancelled";
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
  status: "pending" | "in_progress" | "completed";
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
