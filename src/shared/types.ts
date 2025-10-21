export interface RepositoryConfig {
  organization: string;
  repository: string;
}

export interface Task {
  id: string;
  task_number: number | null;
  slug: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
  origin_product: string;
  status?: string;
  repository_config?: RepositoryConfig;
  tags?: string[];

  // DEPRECATED: These fields have been moved to TaskRun
  github_branch?: string | null;
  github_pr_url?: string | null;
  latest_run?: TaskRun;
}

export interface LogEntry {
  type: string; // e.g., "info", "warning", "error", "success", "debug"
  message: string;
  [key: string]: unknown; // Allow additional fields
}

export interface TaskRun {
  id: string;
  task: string; // Task ID
  team: number;
  branch: string | null;
  status: "started" | "in_progress" | "completed" | "failed";
  log: LogEntry[]; // Array of log entry objects
  error_message: string | null;
  output: Record<string, unknown> | null; // Structured output (PR URL, commit SHA, etc.)
  state: Record<string, unknown>; // Intermediate run state (defaults to {}, never null)
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface AgentDefinition {
  id: string;
  name: string;
  description?: string;
}

export interface AuthConfig {
  apiKey: string;
  apiHost: string;
}

export interface User {
  id: number;
  email: string;
  team: {
    id: number;
    name: string;
  };
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "warning" | "error" | "success";
  message: string;
  data?: unknown;
}

export interface TabState {
  id: string;
  type: "task-list" | "task-detail" | "backlog" | "settings" | "recordings";
  title: string;
  data?: Task | unknown;
}

// URL mention types for RichTextEditor
export type MentionType =
  | "file"
  | "error"
  | "experiment"
  | "insight"
  | "feature_flag"
  | "generic";

export interface MentionItem {
  // File items
  path?: string;
  name?: string;
  // URL items
  url?: string;
  type?: MentionType;
  label?: string;
  id?: string;
  urlId?: string;
}

export interface PostHogUrlInfo {
  type: MentionType;
  id?: string;
  projectId?: string;
  url: string;
  label?: string;
}

// Plan Mode types
export type ExecutionMode = "plan";

export type PlanModePhase =
  | "idle"
  | "research"
  | "questions"
  | "planning"
  | "review";

export interface ClarifyingQuestion {
  id: string;
  question: string;
  options: string[]; // ["a) option1", "b) option2", "c) something else"]
  requiresInput: boolean; // true if option c or custom input needed
}

export interface QuestionAnswer {
  questionId: string;
  selectedOption: string;
  customInput?: string;
}

export interface TaskArtifact {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
}
// Recording types for audio transcription feature
export interface Recording {
  id: string; // Filename
  filename: string;
  duration: number; // Seconds
  created_at: string; // ISO 8601
  file_path: string; // Absolute path
  transcription?: {
    status: "processing" | "completed" | "error";
    text: string;
    summary?: string;
    extracted_tasks?: Array<{
      title: string;
      description: string;
    }>;
    error?: string;
  };
}

export interface ExtractedTask {
  title: string;
  description: string;
}
