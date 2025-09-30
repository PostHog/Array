export interface Task {
  id: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
  origin_product: string;
  status?: string;
  current_stage?: string; // Stage ID
  workflow?: string; // Workflow ID
  repository_config?: {
    organization: string;
    repository: string;
  };
  github_branch?: string;
  github_pr_url?: string;
  tags?: string[];
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  is_default: boolean;
  is_active: boolean;
  stages: WorkflowStage[];
}

export interface WorkflowStage {
  id: string;
  workflow: string;
  name: string;
  key: string;
  position: number;
  color: string;
  agent_name?: string;
  is_manual_only: boolean;
  is_archived: boolean;
  fallback_stage?: string;
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
  type: "task-list" | "task-detail" | "workflow" | "backlog";
  title: string;
  data?: Task | unknown;
}
