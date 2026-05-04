import type {
  GitHandoffCheckpoint,
  HandoffLocalGitState as GitHandoffLocalGitState,
} from "@posthog/git/handoff";

/**
 * Stored custom notification following ACP extensibility model.
 * Custom notifications use underscore-prefixed methods (e.g., `_posthog/phase_start`).
 * See: https://agentclientprotocol.com/docs/extensibility
 */
export interface StoredNotification {
  type: "notification";
  /** When this notification was stored */
  timestamp: string;
  /** JSON-RPC 2.0 notification (no id field = notification, not request) */
  notification: {
    jsonrpc: "2.0";
    method: string;
    params?: Record<string, unknown>;
  };
}

/**
 * Type alias for stored log entries.
 */
export type StoredEntry = StoredNotification;

// PostHog Task model (matches PostHog Code's OpenAPI schema)
export interface Task {
  id: string;
  task_number?: number;
  slug?: string;
  title: string;
  description: string;
  origin_product:
    | "error_tracking"
    | "eval_clusters"
    | "user_created"
    | "support_queue"
    | "session_summaries";
  github_integration?: number | null;
  repository: string; // Format: "organization/repository" (e.g., "posthog/posthog-js")
  json_schema?: Record<string, unknown> | null; // JSON schema for task output validation
  internal?: boolean;
  created_at: string;
  updated_at: string;
  created_by?: {
    id: number;
    uuid: string;
    distinct_id: string;
    first_name: string;
    email: string;
  };
  latest_run?: TaskRun;
}

// Log entry structure for TaskRun.log

export type ArtifactType =
  | "plan"
  | "context"
  | "reference"
  | "output"
  | "artifact"
  | "user_attachment";

export interface TaskRunArtifact {
  id?: string;
  name: string;
  type: ArtifactType;
  source?: string;
  size?: number;
  content_type?: string;
  storage_path?: string;
  uploaded_at?: string;
}

export type TaskRunStatus =
  | "not_started"
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskRunEnvironment = "local" | "cloud";

// TaskRun model - represents individual execution runs of tasks
export interface TaskRun {
  id: string;
  task: string; // Task ID
  team: number;
  branch: string | null;
  stage: string | null; // Current stage (e.g., 'research', 'plan', 'build')
  environment: TaskRunEnvironment;
  status: TaskRunStatus;
  log_url: string;
  error_message: string | null;
  output: Record<string, unknown> | null; // Structured output (PR URL, commit SHA, etc.)
  state: Record<string, unknown>; // Intermediate run state (defaults to {}, never null)
  artifacts?: TaskRunArtifact[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ProcessSpawnedCallback {
  onProcessSpawned?: (info: {
    pid: number;
    command: string;
    sessionId?: string;
  }) => void;
  onProcessExited?: (pid: number) => void;
  onMcpServersReady?: (serverNames: string[]) => void;
}

export interface TaskExecutionOptions {
  repositoryPath?: string;
  adapter?: "claude" | "codex";
  model?: string;
  gatewayUrl?: string;
  codexBinaryPath?: string;
  instructions?: string;
  processCallbacks?: ProcessSpawnedCallback;
  /** Callback invoked when the agent calls the create_output tool for structured output */
  onStructuredOutput?: (output: Record<string, unknown>) => Promise<void>;
  /** Additional directories the agent process can access beyond cwd. */
  additionalDirectories?: string[];
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export type OnLogCallback = (
  level: LogLevel,
  scope: string,
  message: string,
  data?: unknown,
) => void;

export interface PostHogAPIConfig {
  apiUrl: string;
  getApiKey: () => string | Promise<string>;
  refreshApiKey?: () => string | Promise<string>;
  projectId: number;
  userAgent?: string;
}

export interface OtelTransportConfig {
  /** PostHog ingest host, e.g., "https://us.i.posthog.com" */
  host: string;
  /** Project API key */
  apiKey: string;
  /** Override the logs endpoint path (default: /i/v1/logs) */
  logsPath?: string;
}

export interface AgentConfig {
  posthog?: PostHogAPIConfig;
  /** OTEL transport config for shipping logs to PostHog Logs */
  otelTransport?: OtelTransportConfig;
  /** Skip session log persistence (e.g. for preview sessions with no real task) */
  skipLogPersistence?: boolean;
  /** Local cache path for instant log loading (e.g., ~/.posthog-code) */
  localCachePath?: string;
  /**
   * Annotate files the agent reads with PostHog enrichment (event volume,
   * flag rollout/staleness, experiment links). Defaults to enabled when
   * `posthog` config is present; set `{ enabled: false }` to opt out.
   */
  enricher?: { enabled?: boolean };
  debug?: boolean;
  onLog?: OnLogCallback;
}

// Device info for tracking where work happens
export interface DeviceInfo {
  type: "local" | "cloud";
  name?: string;
}

// Agent execution mode - for tracking interactive vs background runs, when backgrounded an agent will continue working without asking questions
export type AgentMode = "interactive" | "background";

// Git file status codes
export type FileStatus = "A" | "M" | "D";

export interface FileChange {
  path: string;
  status: FileStatus;
}

export type HandoffLocalGitState = GitHandoffLocalGitState;

export interface GitCheckpoint extends GitHandoffCheckpoint {
  artifactPath?: string;
  indexArtifactPath?: string;
}

export interface GitCheckpointEvent extends GitCheckpoint {
  device?: DeviceInfo;
}

/**
 * Keeps the emitted `@posthog/agent/types` entrypoint as a runtime ESM module.
 *
 * `export {}` is stripped by tsup in this package, which leaves `dist/types.js`
 * empty and breaks downstream type resolution for the exported subpath.
 */
export const AGENT_TYPES_MODULE = true;
