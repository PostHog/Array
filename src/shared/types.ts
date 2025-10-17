export interface RepositoryConfig {
  organization: string;
  repository: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
  origin_product: string;
  status?: string;
  workflow?: string | null; // Workflow ID
  repository_config?: RepositoryConfig;
  tags?: string[];

  // DEPRECATED: These fields have been moved to TaskRun
  current_stage?: string | null;
  github_branch?: string | null;
  github_pr_url?: string | null;
  latest_run?: TaskRun;
}

export interface TaskRun {
  id: string;
  task: string; // Task ID
  team: number;
  branch: string | null;
  current_stage: string | null; // WorkflowStage ID
  status: "started" | "in_progress" | "completed" | "failed";
  log: string;
  error_message: string | null;
  output: Record<string, unknown> | null; // Structured output (PR URL, commit SHA, etc.)
  state: Record<string, unknown>; // Intermediate run state (defaults to {}, never null)
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  is_default?: boolean;
  is_active?: boolean;
  stages: WorkflowStage[];
}

export interface WorkflowStage {
  id: string;
  workflow: string;
  name: string;
  key: string;
  position: number;
  color?: string;
  agent_name?: string | null;
  is_manual_only?: boolean;
  is_archived?: boolean;
  fallback_stage?: string | null;
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
  type: "task-list" | "task-detail" | "workflow" | "backlog" | "settings";
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
