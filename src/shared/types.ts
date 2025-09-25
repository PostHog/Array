export interface Task {
  id: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
  origin_product: string;
  status?: string;
  current_stage?: {
    id: string;
    name: string;
    key: string;
  };
  workflow?: {
    id: string;
    name: string;
  };
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
  name: string;
  key: string;
  order: number;
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
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
  data?: any;
}

export interface TabState {
  id: string;
  type: 'task-list' | 'task-detail';
  title: string;
  data?: any;
}