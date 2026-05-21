// Analytics event types and properties

import type {
  PromptHistoryOpenedProperties,
  PromptHistorySelectedProperties,
} from "@features/message-editor/analytics";

type ExecutionType = "cloud" | "local";
export type RepositoryProvider = "github" | "gitlab" | "local" | "none";
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
  | "open-review-panel"
  | "open-task";

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
  workspace_mode?: "local" | "worktree" | "cloud";
  has_branch?: boolean;
  /** Worktree mode: a project environment with a setup script was selected */
  has_environment_setup?: boolean;
  /** Cloud mode: a sandbox environment was selected */
  has_sandbox_environment?: boolean;
  cloud_run_source?: "manual" | "signal_report";
  cloud_pr_authorship_mode?: "user" | "bot";
  /** Worktree mode: repo has a non-empty .worktreelink file */
  uses_worktree_link?: boolean;
  /** Worktree mode: repo has a non-empty .worktreeinclude file */
  uses_worktree_include?: boolean;
  adapter?: "claude" | "codex";
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

// Onboarding events
export type OnboardingStepId =
  | "welcome"
  | "project-select"
  | "invite-code"
  | "github"
  | "install-cli";

type OnboardingSkipReason = "tools_not_installed" | "dev_skip";

export interface OnboardingStepViewedProperties {
  step_id: OnboardingStepId;
  step_index: number;
  total_steps: number;
}

export interface OnboardingStepCompletedProperties {
  step_id: OnboardingStepId;
  step_index: number;
  total_steps: number;
  duration_seconds: number;
}

export interface OnboardingStepSkippedProperties {
  step_id: OnboardingStepId;
  step_index: number;
  reason: OnboardingSkipReason;
}

export interface OnboardingSignInInitiatedProperties {
  region: string;
}

export interface OnboardingProjectSelectedProperties {
  had_multiple_orgs: boolean;
  had_multiple_projects: boolean;
}

export interface OnboardingInviteCodeSubmittedProperties {
  success: boolean;
  error_type?: string;
}

export interface OnboardingFolderSelectedProperties {
  has_git_remote: boolean;
  repository_provider: RepositoryProvider;
}

export interface OnboardingCliCheckCompletedProperties {
  git_installed: boolean;
  gh_installed: boolean;
  gh_authenticated: boolean;
}

export interface OnboardingCompletedProperties {
  duration_seconds: number;
  github_connected: boolean;
  cli_skipped: boolean;
}

export interface OnboardingAbandonedProperties {
  last_step_id: OnboardingStepId;
  duration_seconds: number;
}

export interface AiConsentGateShownProperties {
  is_org_admin: boolean;
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
  | "posthog_setup"
  | "experiment";

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

// Inbox events
export type InboxReportOpenMethod =
  | "click"
  | "click_cmd"
  | "click_shift"
  | "keyboard"
  | "deeplink"
  | "unknown";

export type InboxReportCloseMethod =
  | "next_report"
  | "deselected"
  | "navigated_away"
  | "unmount";

export type InboxReportActionType =
  | "dismiss"
  | "snooze"
  | "delete"
  | "reingest"
  | "create_pr"
  | "open_pr"
  | "copy_link"
  | "expand_signal"
  | "collapse_signal"
  | "expand_signal_section"
  | "view_signal_external"
  | "expand_why"
  | "click_suggested_reviewer"
  | "expand_task_section"
  | "play_session_recording";

export type InboxReportActionSurface =
  | "detail_pane"
  | "toolbar"
  | "keyboard"
  | "list_row";

export interface InboxViewedProperties {
  report_count: number;
  total_count: number;
  ready_count: number;
  has_active_filters: boolean;
  source_product_filter: string[];
  status_filter_count: number;
  is_empty: boolean;
}

export interface InboxReportOpenedProperties {
  report_id: string;
  report_title: string | null;
  report_age_hours: number;
  status: string | null;
  priority: string | null;
  source_products: string[];
  rank: number;
  list_size: number;
  open_method: InboxReportOpenMethod;
  previous_report_id: string | null;
}

export interface InboxReportClosedProperties {
  report_id: string;
  report_title: string | null;
  report_age_hours: number;
  time_spent_ms: number;
  scrolled: boolean;
  close_method: InboxReportCloseMethod;
}

export interface InboxReportScrolledProperties {
  report_id: string;
  report_title: string | null;
  report_age_hours: number;
  rank: number;
  list_size: number;
  time_since_open_ms: number;
}

export interface InboxReportActionProperties {
  report_id: string;
  report_title: string | null;
  report_age_hours: number;
  action_type: InboxReportActionType;
  surface: InboxReportActionSurface;
  is_bulk: boolean;
  bulk_size: number;
  rank: number;
  list_size: number;
  dismissal_reason?: string;
  signal_id?: string;
  signal_source_product?: string;
  signal_source_type?: string;
  signal_section?: "relevant_code" | "data_queried";
  why_field?: "priority" | "actionability";
  task_section?: "research" | "implementation";
}

// Subscription / billing events
export interface SubscriptionStartedProperties {
  plan_key: string;
  previous_plan_key?: string;
}

export interface SubscriptionCancelledProperties {
  plan_key: string;
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

  // Onboarding events
  ONBOARDING_STARTED: "Onboarding started",
  ONBOARDING_STEP_VIEWED: "Onboarding step viewed",
  ONBOARDING_STEP_COMPLETED: "Onboarding step completed",
  ONBOARDING_STEP_SKIPPED: "Onboarding step skipped",
  ONBOARDING_SIGN_IN_INITIATED: "Onboarding sign in initiated",
  ONBOARDING_PROJECT_SELECTED: "Onboarding project selected",
  ONBOARDING_INVITE_CODE_SUBMITTED: "Onboarding invite code submitted",
  ONBOARDING_FOLDER_SELECTED: "Onboarding folder selected",
  ONBOARDING_GITHUB_CONNECTED: "Onboarding github connected",
  ONBOARDING_CLI_CHECK_COMPLETED: "Onboarding cli check completed",
  ONBOARDING_COMPLETED: "Onboarding completed",
  ONBOARDING_ABANDONED: "Onboarding abandoned",
  AI_CONSENT_GATE_SHOWN: "Ai consent gate shown",
  AI_CONSENT_APPROVED: "Ai consent approved",
  INBOX_VIEWED: "Inbox viewed",

  // Setup / onboarding events
  SETUP_DISCOVERY_STARTED: "Setup discovery started",
  SETUP_DISCOVERY_COMPLETED: "Setup discovery completed",
  SETUP_DISCOVERY_FAILED: "Setup discovery failed",
  SETUP_TASK_SELECTED: "Setup task selected",
  SETUP_TASK_DISMISSED: "Setup task dismissed",

  // Error events
  TASK_CREATION_FAILED: "Task creation failed",
  AGENT_SESSION_ERROR: "Agent session error",

  // Inbox events
  INBOX_INTEREST_REGISTERED: "Inbox interest registered",
  INBOX_VIEWED: "Inbox viewed",
  INBOX_REPORT_OPENED: "Inbox report opened",
  INBOX_REPORT_CLOSED: "Inbox report closed",
  INBOX_REPORT_ACTION: "Inbox report action",
  INBOX_REPORT_SCROLLED: "Inbox report scrolled",

  // Prompt history events
  PROMPT_HISTORY_OPENED: "Prompt history opened",
  PROMPT_HISTORY_SELECTED: "Prompt history selected",

  // Subscription events
  SUBSCRIPTION_STARTED: "Subscription started",
  SUBSCRIPTION_CANCELLED: "Subscription cancelled",
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

  // Onboarding events
  [ANALYTICS_EVENTS.ONBOARDING_STARTED]: never;
  [ANALYTICS_EVENTS.ONBOARDING_STEP_VIEWED]: OnboardingStepViewedProperties;
  [ANALYTICS_EVENTS.ONBOARDING_STEP_COMPLETED]: OnboardingStepCompletedProperties;
  [ANALYTICS_EVENTS.ONBOARDING_STEP_SKIPPED]: OnboardingStepSkippedProperties;
  [ANALYTICS_EVENTS.ONBOARDING_SIGN_IN_INITIATED]: OnboardingSignInInitiatedProperties;
  [ANALYTICS_EVENTS.ONBOARDING_PROJECT_SELECTED]: OnboardingProjectSelectedProperties;
  [ANALYTICS_EVENTS.ONBOARDING_INVITE_CODE_SUBMITTED]: OnboardingInviteCodeSubmittedProperties;
  [ANALYTICS_EVENTS.ONBOARDING_FOLDER_SELECTED]: OnboardingFolderSelectedProperties;
  [ANALYTICS_EVENTS.ONBOARDING_GITHUB_CONNECTED]: never;
  [ANALYTICS_EVENTS.ONBOARDING_CLI_CHECK_COMPLETED]: OnboardingCliCheckCompletedProperties;
  [ANALYTICS_EVENTS.ONBOARDING_COMPLETED]: OnboardingCompletedProperties;
  [ANALYTICS_EVENTS.ONBOARDING_ABANDONED]: OnboardingAbandonedProperties;
  [ANALYTICS_EVENTS.AI_CONSENT_GATE_SHOWN]: AiConsentGateShownProperties;
  [ANALYTICS_EVENTS.AI_CONSENT_APPROVED]: never;
  [ANALYTICS_EVENTS.INBOX_VIEWED]: never;

  // Setup / onboarding events
  [ANALYTICS_EVENTS.SETUP_DISCOVERY_STARTED]: SetupDiscoveryStartedProperties;
  [ANALYTICS_EVENTS.SETUP_DISCOVERY_COMPLETED]: SetupDiscoveryCompletedProperties;
  [ANALYTICS_EVENTS.SETUP_DISCOVERY_FAILED]: SetupDiscoveryFailedProperties;
  [ANALYTICS_EVENTS.SETUP_TASK_SELECTED]: SetupTaskSelectedProperties;
  [ANALYTICS_EVENTS.SETUP_TASK_DISMISSED]: SetupTaskDismissedProperties;

  // Error events
  [ANALYTICS_EVENTS.TASK_CREATION_FAILED]: TaskCreationFailedProperties;
  [ANALYTICS_EVENTS.AGENT_SESSION_ERROR]: AgentSessionErrorProperties;

  // Inbox events
  [ANALYTICS_EVENTS.INBOX_INTEREST_REGISTERED]: never;
  [ANALYTICS_EVENTS.INBOX_VIEWED]: InboxViewedProperties;
  [ANALYTICS_EVENTS.INBOX_REPORT_OPENED]: InboxReportOpenedProperties;
  [ANALYTICS_EVENTS.INBOX_REPORT_CLOSED]: InboxReportClosedProperties;
  [ANALYTICS_EVENTS.INBOX_REPORT_ACTION]: InboxReportActionProperties;
  [ANALYTICS_EVENTS.INBOX_REPORT_SCROLLED]: InboxReportScrolledProperties;

  // Prompt history events
  [ANALYTICS_EVENTS.PROMPT_HISTORY_OPENED]: PromptHistoryOpenedProperties;
  [ANALYTICS_EVENTS.PROMPT_HISTORY_SELECTED]: PromptHistorySelectedProperties;

  // Subscription events
  [ANALYTICS_EVENTS.SUBSCRIPTION_STARTED]: SubscriptionStartedProperties;
  [ANALYTICS_EVENTS.SUBSCRIPTION_CANCELLED]: SubscriptionCancelledProperties;
};
