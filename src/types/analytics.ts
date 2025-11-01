// Analytics event types and properties

export type ExecutionType = "cloud" | "local";
export type ExecutionMode = "plan" | "execute";
export type RepositoryProvider = "github" | "gitlab" | "local" | "none";
export type TaskCreatedFrom = "cli" | "command-menu";
export type RepositorySelectSource = "task-creation" | "task-detail";

// Event property interfaces
export interface TaskListViewProperties {
  filter_type?: string;
  sort_field?: string;
  view_mode?: string;
}

export interface TaskCreateProperties {
  has_repository: boolean;
  auto_run: boolean;
  created_from: TaskCreatedFrom;
  repository_provider?: RepositoryProvider;
}

export interface TaskViewProperties {
  task_id: string;
  has_repository: boolean;
}

export interface TaskRunProperties {
  task_id: string;
  execution_type: ExecutionType;
  execution_mode: ExecutionMode;
  has_repository: boolean;
  repository_provider: RepositoryProvider;
}

export interface RepositorySelectProperties {
  repository_provider: RepositoryProvider;
  source: RepositorySelectSource;
}

export interface UserIdentifyProperties {
  user_id?: string;
  project_id?: string;
  region?: string;
}

// Event names as constants
export const ANALYTICS_EVENTS = {
  // App lifecycle
  APP_STARTED: "App started",
  APP_QUIT: "App quit",

  // Authentication
  USER_LOGGED_IN: "User logged in",
  USER_LOGGED_OUT: "User logged out",

  // Task management
  TASK_LIST_VIEWED: "Task list viewed",
  TASK_CREATED: "Task created",
  TASK_VIEWED: "Task viewed",
  TASK_RUN: "Task run",

  // Repository
  REPOSITORY_SELECTED: "Repository selected",
} as const;

export type AnalyticsEvent =
  (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];
