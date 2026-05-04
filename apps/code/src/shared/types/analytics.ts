// Analytics event types and properties

type ExecutionType = "cloud" | "local";
type RepositoryProvider = "github" | "gitlab" | "local" | "none";
type TaskCreatedFrom = "cli" | "command-menu";
type RepositorySelectSource = "task-creation" | "task-detail";
type GitActionType =
  | "push"
  | "pull"
  | "sync"
  | "publish"
  | "commit"
  | "commit-push"
  | "create-pr"
  | "view-pr"
  | "update-pr"
  | "branch-here";
export type FeedbackType = "good" | "bad" | "general";
type FileOpenSource = "sidebar" | "agent-suggestion" | "search" | "diff";
export type FileChangeType = "added" | "modified" | "deleted";
type StopReason = "user_cancelled" | "completed" | "error" | "timeout";
export type SkillButtonId =
  | "add-analytics"
  | "create-feature-flags"
  | "run-experiment"
  | "add-error-tracking"
  | "instrument-llm-calls"
  | "add-logging";
type SkillButtonSource = "primary" | "dropdown";
export type CommandMenuAction =
  | "home"
  | "new-task"
  | "settings"
  | "logout"
  | "toggle-theme"
  | "toggle-left-sidebar"
  | "open-review-panel";

// Event property interfaces
export interface TaskListViewProperties {
  filter_type?: string;
  sort_field?: string;
  view_mode?: string;
}

export interface TaskCreateProperties {
  auto_run: boolean;
  created_from: TaskCreatedFrom;
  repository_provider?: RepositoryProvider;
}

export interface TaskViewProperties {
  task_id: string;
}

export interface TaskRunProperties {
  task_id: string;
  execution_type: ExecutionType;
}

export interface RepositorySelectProperties {
  repository_provider: RepositoryProvider;
  source: RepositorySelectSource;
}

export interface UserIdentifyProperties {
  email?: string;
  uuid?: string;
  project_id?: string;
  region?: string;
}
export interface TaskRunStartedProperties {
  task_id: string;
  execution_type: ExecutionType;
  model?: string;
  initial_mode?: string;
  adapter?: string;
}

export interface TaskRunCompletedProperties {
  task_id: string;
  execution_type: ExecutionType;
  duration_seconds: number;
  prompts_sent: number;
  stop_reason: StopReason;
}

export interface TaskRunCancelledProperties {
  task_id: string;
  execution_type: ExecutionType;
  duration_seconds: number;
  prompts_sent: number;
}

export interface PromptSentProperties {
  task_id: string;
  is_initial: boolean;
  execution_type: ExecutionType;
  prompt_length_chars: number;
}

// Git operations
export interface GitActionExecutedProperties {
  action_type: GitActionType;
  success: boolean;
  task_id?: string;
  /** Number of staged files at time of action */
  staged_file_count?: number;
  /** Number of unstaged files at time of action */
  unstaged_file_count?: number;
  /** Whether user chose to commit all changes (vs staged only) */
  commit_all?: boolean;
  /** Whether stagedOnly mode was used for the commit */
  staged_only?: boolean;
}

export interface PrCreatedProperties {
  task_id?: string;
  success: boolean;
}

export interface AgentFileActivityProperties {
  task_id: string;
  branch_name: string | null;
}

// Branch link events
type BranchLinkSource = "agent" | "user" | "unknown";

export interface BranchLinkedProperties {
  task_id: string;
  branch_name: string;
  source: BranchLinkSource;
}

export interface BranchUnlinkedProperties {
  task_id: string;
  source: BranchLinkSource;
}

export interface BranchLinkDefaultBranchUnknownProperties {
  task_id: string;
  branch_name: string;
}

// File interactions
export interface FileOpenedProperties {
  file_extension: string;
  source: FileOpenSource;
  task_id?: string;
}

export interface FileDiffViewedProperties {
  file_extension: string;
  change_type: FileChangeType;
  task_id?: string;
}

export interface ReviewPanelViewedProperties {
  task_id: string;
}

export interface DiffViewModeChangedProperties {
  from_mode: "split" | "unified";
  to_mode: "split" | "unified";
}

// Workspace events
export interface WorkspaceCreatedProperties {
  task_id: string;
  mode: "cloud" | "worktree" | "local";
}

export interface WorkspaceScriptsStartedProperties {
  task_id: string;
  scripts_count: number;
}

export interface FolderRegisteredProperties {
  path_hash: string;
}

// Navigation events
export interface CommandMenuActionProperties {
  action_type: CommandMenuAction;
}

export interface SkillButtonTriggeredProperties {
  task_id: string;
  button_id: SkillButtonId;
  source: SkillButtonSource;
}

// Settings events
export interface SettingChangedProperties {
  setting_name: string;
  new_value: string | boolean | number;
  old_value?: string | boolean | number;
}

// Error events
export interface TaskCreationFailedProperties {
  error_type: string;
  failed_step?: string;
}

export interface AgentSessionErrorProperties {
  task_id: string;
  error_type: string;
}

// Permission events
export interface PermissionRespondedProperties {
  task_id: string;
  tool_name?: string;
  option_id?: string;
  option_kind?: string;
  custom_input?: string;
}

export interface PermissionCancelledProperties {
  task_id: string;
  tool_name?: string;
}

// Session config events
export interface SessionConfigChangedProperties {
  task_id: string;
  category: string;
  from_value: string;
  to_value: string;
}

// Tour events
type TourAction = "started" | "step_advanced" | "dismissed" | "completed";

export interface TourEventProperties {
  tour_id: string;
  action: TourAction;
  step_id?: string;
  step_index?: number;
  total_steps?: number;
}

// Branch mismatch events
type BranchMismatchAction = "switch" | "continue" | "cancel";

export interface BranchMismatchWarningShownProperties {
  task_id: string;
  linked_branch: string;
  current_branch: string;
  has_uncommitted_changes: boolean;
}

export interface BranchMismatchActionProperties {
  task_id: string;
  action: BranchMismatchAction;
  linked_branch: string;
  current_branch: string;
}

// Feedback events
export interface TaskFeedbackProperties {
  task_id: string;
  task_run_id?: string;
  log_url?: string;
  event_count: number;
  feedback_type: FeedbackType;
  feedback_comment?: string;
}

// Setup / onboarding events
type SetupDiscoveredTaskCategory =
  | "bug"
  | "security"
  | "dead_code"
  | "duplication"
  | "performance"
  | "stale_feature_flag"
  | "error_tracking"
  | "event_tracking"
  | "funnel"
  | "posthog_setup";

export interface SetupViewedProperties {
  discovery_status: "idle" | "running" | "done" | "error";
}

export interface SetupDiscoveryStartedProperties {
  discovery_task_id: string;
  discovery_task_run_id: string;
}

export interface SetupDiscoveryCompletedProperties {
  discovery_task_id: string;
  discovery_task_run_id: string;
  task_count: number;
  duration_seconds: number;
  signal_source: "structured_output" | "terminal_status" | "missing_output";
}

export interface SetupDiscoveryFailedProperties {
  discovery_task_id?: string;
  discovery_task_run_id?: string;
  reason: "failed" | "cancelled" | "timeout" | "startup_error";
  error_message?: string;
}

export interface SetupTaskSelectedProperties {
  discovered_task_id: string;
  category: SetupDiscoveredTaskCategory;
  position: number;
  total_discovered: number;
}

export interface SetupTaskDismissedProperties {
  discovered_task_id: string;
  category: SetupDiscoveredTaskCategory;
  position: number;
  total_discovered: number;
}

export interface SetupSkippedProperties {
  discovery_status: "idle" | "running" | "done" | "error";
  had_discovered_tasks: boolean;
  entry_point: "during_scan" | "after_done";
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
  TASK_RUN_STARTED: "Task run started",
  TASK_RUN_COMPLETED: "Task run completed",
  TASK_RUN_CANCELLED: "Task run cancelled",
  PROMPT_SENT: "Prompt sent",

  // Repository
  REPOSITORY_SELECTED: "Repository selected",

  // Git operations
  GIT_ACTION_EXECUTED: "Git action executed",
  PR_CREATED: "PR created",
  AGENT_FILE_ACTIVITY: "Agent file activity",
  BRANCH_LINKED: "Branch linked",
  BRANCH_UNLINKED: "Branch unlinked",
  BRANCH_LINK_DEFAULT_BRANCH_UNKNOWN: "Branch link default branch unknown",

  // File interactions
  FILE_OPENED: "File opened",
  FILE_DIFF_VIEWED: "File diff viewed",
  REVIEW_PANEL_VIEWED: "Review panel viewed",
  DIFF_VIEW_MODE_CHANGED: "Diff view mode changed",

  // Workspace events
  WORKSPACE_CREATED: "Workspace created",
  WORKSPACE_SCRIPTS_STARTED: "Workspace scripts started",
  FOLDER_REGISTERED: "Folder registered",

  // Navigation events
  SETTINGS_VIEWED: "Settings viewed",
  COMMAND_MENU_OPENED: "Command menu opened",
  COMMAND_MENU_ACTION: "Command menu action",
  COMMAND_CENTER_VIEWED: "Command center viewed",
  SKILL_BUTTON_TRIGGERED: "Skill button triggered",

  // Permission events
  PERMISSION_RESPONDED: "Permission responded",
  PERMISSION_CANCELLED: "Permission cancelled",

  // Session config events
  SESSION_CONFIG_CHANGED: "Session config changed",

  // Settings events
  SETTING_CHANGED: "Setting changed",

  // Feedback events
  TASK_FEEDBACK: "Task feedback",

  // Branch mismatch events
  BRANCH_MISMATCH_WARNING_SHOWN: "Branch mismatch warning shown",
  BRANCH_MISMATCH_ACTION: "Branch mismatch action",

  // Tour events
  TOUR_EVENT: "Tour event",

  // Setup / onboarding events
  SETUP_VIEWED: "Setup viewed",
  SETUP_DISCOVERY_STARTED: "Setup discovery started",
  SETUP_DISCOVERY_COMPLETED: "Setup discovery completed",
  SETUP_DISCOVERY_FAILED: "Setup discovery failed",
  SETUP_TASK_SELECTED: "Setup task selected",
  SETUP_TASK_DISMISSED: "Setup task dismissed",
  SETUP_SKIPPED: "Setup skipped",

  // Error events
  TASK_CREATION_FAILED: "Task creation failed",
  AGENT_SESSION_ERROR: "Agent session error",

  // Inbox events
  INBOX_INTEREST_REGISTERED: "Inbox interest registered",
} as const;

// Event property mapping
export type EventPropertyMap = {
  [ANALYTICS_EVENTS.TASK_LIST_VIEWED]: TaskListViewProperties | undefined;
  [ANALYTICS_EVENTS.TASK_CREATED]: TaskCreateProperties;
  [ANALYTICS_EVENTS.TASK_VIEWED]: TaskViewProperties;
  [ANALYTICS_EVENTS.TASK_RUN]: TaskRunProperties;
  [ANALYTICS_EVENTS.REPOSITORY_SELECTED]: RepositorySelectProperties;
  [ANALYTICS_EVENTS.USER_LOGGED_IN]: UserIdentifyProperties | undefined;
  [ANALYTICS_EVENTS.USER_LOGGED_OUT]: never;

  // Task execution events
  [ANALYTICS_EVENTS.TASK_RUN_STARTED]: TaskRunStartedProperties;
  [ANALYTICS_EVENTS.TASK_RUN_COMPLETED]: TaskRunCompletedProperties;
  [ANALYTICS_EVENTS.TASK_RUN_CANCELLED]: TaskRunCancelledProperties;
  [ANALYTICS_EVENTS.PROMPT_SENT]: PromptSentProperties;

  // Git operations
  [ANALYTICS_EVENTS.GIT_ACTION_EXECUTED]: GitActionExecutedProperties;
  [ANALYTICS_EVENTS.PR_CREATED]: PrCreatedProperties;
  [ANALYTICS_EVENTS.AGENT_FILE_ACTIVITY]: AgentFileActivityProperties;
  [ANALYTICS_EVENTS.BRANCH_LINKED]: BranchLinkedProperties;
  [ANALYTICS_EVENTS.BRANCH_UNLINKED]: BranchUnlinkedProperties;
  [ANALYTICS_EVENTS.BRANCH_LINK_DEFAULT_BRANCH_UNKNOWN]: BranchLinkDefaultBranchUnknownProperties;

  // File interactions
  [ANALYTICS_EVENTS.FILE_OPENED]: FileOpenedProperties;
  [ANALYTICS_EVENTS.FILE_DIFF_VIEWED]: FileDiffViewedProperties;
  [ANALYTICS_EVENTS.REVIEW_PANEL_VIEWED]: ReviewPanelViewedProperties;
  [ANALYTICS_EVENTS.DIFF_VIEW_MODE_CHANGED]: DiffViewModeChangedProperties;

  // Workspace events
  [ANALYTICS_EVENTS.WORKSPACE_CREATED]: WorkspaceCreatedProperties;
  [ANALYTICS_EVENTS.WORKSPACE_SCRIPTS_STARTED]: WorkspaceScriptsStartedProperties;
  [ANALYTICS_EVENTS.FOLDER_REGISTERED]: FolderRegisteredProperties;

  // Navigation events
  [ANALYTICS_EVENTS.SETTINGS_VIEWED]: never;
  [ANALYTICS_EVENTS.COMMAND_MENU_OPENED]: never;
  [ANALYTICS_EVENTS.COMMAND_MENU_ACTION]: CommandMenuActionProperties;
  [ANALYTICS_EVENTS.COMMAND_CENTER_VIEWED]: never;
  [ANALYTICS_EVENTS.SKILL_BUTTON_TRIGGERED]: SkillButtonTriggeredProperties;

  // Permission events
  [ANALYTICS_EVENTS.PERMISSION_RESPONDED]: PermissionRespondedProperties;
  [ANALYTICS_EVENTS.PERMISSION_CANCELLED]: PermissionCancelledProperties;

  // Session config events
  [ANALYTICS_EVENTS.SESSION_CONFIG_CHANGED]: SessionConfigChangedProperties;

  // Settings events
  [ANALYTICS_EVENTS.SETTING_CHANGED]: SettingChangedProperties;

  // Feedback events
  [ANALYTICS_EVENTS.TASK_FEEDBACK]: TaskFeedbackProperties;

  // Branch mismatch events
  [ANALYTICS_EVENTS.BRANCH_MISMATCH_WARNING_SHOWN]: BranchMismatchWarningShownProperties;
  [ANALYTICS_EVENTS.BRANCH_MISMATCH_ACTION]: BranchMismatchActionProperties;

  // Tour events
  [ANALYTICS_EVENTS.TOUR_EVENT]: TourEventProperties;

  // Setup / onboarding events
  [ANALYTICS_EVENTS.SETUP_VIEWED]: SetupViewedProperties;
  [ANALYTICS_EVENTS.SETUP_DISCOVERY_STARTED]: SetupDiscoveryStartedProperties;
  [ANALYTICS_EVENTS.SETUP_DISCOVERY_COMPLETED]: SetupDiscoveryCompletedProperties;
  [ANALYTICS_EVENTS.SETUP_DISCOVERY_FAILED]: SetupDiscoveryFailedProperties;
  [ANALYTICS_EVENTS.SETUP_TASK_SELECTED]: SetupTaskSelectedProperties;
  [ANALYTICS_EVENTS.SETUP_TASK_DISMISSED]: SetupTaskDismissedProperties;
  [ANALYTICS_EVENTS.SETUP_SKIPPED]: SetupSkippedProperties;

  // Error events
  [ANALYTICS_EVENTS.TASK_CREATION_FAILED]: TaskCreationFailedProperties;
  [ANALYTICS_EVENTS.AGENT_SESSION_ERROR]: AgentSessionErrorProperties;

  // Inbox events
  [ANALYTICS_EVENTS.INBOX_INTEREST_REGISTERED]: never;
};
