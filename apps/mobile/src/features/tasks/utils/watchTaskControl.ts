import type {
  AvailableSuggestedReviewer,
  SignalReport,
  SuggestedReviewer,
} from "@/features/inbox/types";
import type { TaskSession } from "../stores/taskSessionStore";
import type {
  PlanEntry,
  SessionEvent,
  SessionNotification,
  Task,
  TaskAutomation,
  TaskRun,
  WatchAutomationSnapshot,
  WatchInboxReportAction,
  WatchInboxReportSnapshot,
  WatchInboxReviewer,
  WatchInboxSuggestedReviewer,
  WatchTaskActionType,
  WatchTaskApproval,
  WatchTaskApprovalOption,
  WatchTaskChecklistItem,
  WatchTaskChecklistStatus,
  WatchTaskEnvelope,
  WatchTaskProgress,
  WatchTaskRisk,
  WatchTaskSnapshot,
  WatchTaskStatus,
  WatchTaskTimelineItem,
} from "../types";
import { formatAutomationScheduleSummary } from "./automationSchedule";
import { getAutomationStatusPresentation } from "./automationStatus";
import { getAutomationTemplatePresentation } from "./automationTemplatePresentation";

const MAX_TITLE_LENGTH = 72;
const MAX_DETAIL_LENGTH = 160;
const MAX_CHECKLIST_ITEMS = 8;
const MAX_TIMELINE_ITEMS = 6;
const STALE_AFTER_MS = 30_000;

interface TaskBuildOptions {
  now?: number;
  isStale?: boolean;
  staleReason?: string;
  isArchived?: boolean;
}

interface WatchInboxBuildOptions {
  reviewers?: SuggestedReviewer[];
  repository?: string | null;
  currentUserUuid?: string;
}

interface ToolState {
  id: string;
  title: string;
  status: WatchTaskChecklistStatus;
  args?: Record<string, unknown>;
  result?: unknown;
  ts: number;
  isAgent?: boolean;
  parentToolCallId?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function truncate(value: string | null | undefined, max = MAX_DETAIL_LENGTH) {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function toMillis(value?: string | null): number | undefined {
  if (!value) return undefined;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function mapPlanStatus(status: PlanEntry["status"]): WatchTaskChecklistStatus {
  if (status === "in_progress") return "running";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "pending";
}

function mapToolStatus(
  status?: "pending" | "in_progress" | "completed" | "failed" | null,
): WatchTaskChecklistStatus {
  switch (status) {
    case "in_progress":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "pending";
  }
}

function calculateProgress(items: WatchTaskChecklistItem[]): WatchTaskProgress {
  const total = items.length;
  const completed = items.filter((item) => item.status === "completed").length;
  const running = items.filter((item) => item.status === "running").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const pending = Math.max(0, total - completed - running - failed);
  return {
    completed,
    running,
    pending,
    failed,
    total,
    fraction: total > 0 ? clamp(completed / total, 0, 1) : 0,
  };
}

function extractSessionUpdate(
  event: SessionEvent,
): SessionNotification["update"] | null {
  if (event.type !== "session_update") return null;
  return event.notification.update ?? null;
}

function isQuestionTool(tool: ToolState): boolean {
  if (tool.title.toLowerCase().includes("question")) return true;
  const args = tool.args;
  if (!args) return false;
  if (Array.isArray(args.questions)) return true;
  const input = args.input;
  return !!(
    input &&
    typeof input === "object" &&
    Array.isArray((input as Record<string, unknown>).questions)
  );
}

function extractQuestions(args?: Record<string, unknown>): Array<{
  question: string;
  header?: string;
  options?: Array<{ label?: string; description?: string; optionId?: string }>;
}> {
  const raw =
    args?.questions ??
    (args?.input as Record<string, unknown> | undefined)?.questions;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (
      item,
    ): item is {
      question: string;
      header?: string;
      options?: Array<{
        label?: string;
        description?: string;
        optionId?: string;
      }>;
    } =>
      !!item &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).question === "string",
  );
}

function deriveToolRisk(tool: ToolState): WatchTaskRisk {
  const haystack =
    `${tool.title} ${JSON.stringify(tool.args ?? {})}`.toLowerCase();
  if (
    haystack.includes("delete") ||
    haystack.includes("rm -rf") ||
    haystack.includes("drop table") ||
    haystack.includes("destroy")
  ) {
    return "destructive";
  }
  if (
    haystack.includes("git push") ||
    haystack.includes("deploy") ||
    haystack.includes("production") ||
    haystack.includes("write") ||
    haystack.includes("edit")
  ) {
    return "high";
  }
  if (haystack.includes("bash") || haystack.includes("execute"))
    return "medium";
  return "low";
}

function formatToolSummary(tool: ToolState): string {
  const args = tool.args ?? {};
  if (typeof args.file_path === "string") return args.file_path;
  if (typeof args.target_file === "string") return args.target_file;
  if (typeof args.command === "string") return args.command;
  if (typeof args.pattern === "string") return `Search for “${args.pattern}”`;
  if (typeof args.prompt === "string") return args.prompt;
  return tool.title;
}

function extractApproval(tool: ToolState): WatchTaskApproval | undefined {
  if (tool.status === "completed" || tool.status === "failed") return undefined;

  const questions = extractQuestions(tool.args);
  if (
    questions.length > 0 ||
    isQuestionTool(tool) ||
    deriveToolRisk(tool) !== "low"
  ) {
    const firstQuestion = questions[0];
    const title =
      truncate(firstQuestion?.header ?? tool.title, MAX_TITLE_LENGTH) ??
      "Approval needed";
    const summary =
      truncate(
        firstQuestion?.question ?? formatToolSummary(tool),
        MAX_DETAIL_LENGTH,
      ) ?? "Agent is waiting for approval.";
    const risk = deriveToolRisk(tool);
    const questionOptions = firstQuestion?.options ?? [];
    const options: WatchTaskApprovalOption[] =
      questionOptions.length > 0
        ? questionOptions.slice(0, 3).map((option, index) => {
            const title = option.label ?? `Option ${index + 1}`;
            const normalized = title.toLowerCase();
            return {
              id: option.optionId ?? `option_${index}`,
              title: truncate(title, 28) ?? title,
              role:
                normalized.includes("reject") || normalized.includes("no")
                  ? "reject"
                  : "approve",
              destructive: risk === "destructive" && index === 0,
            };
          })
        : [
            {
              id: "allow",
              title: risk === "destructive" ? "Approve" : "Allow",
              role: "approve",
              destructive: risk === "destructive",
            },
            { id: "reject", title: "Reject", role: "reject" },
          ];

    return {
      id: tool.id,
      toolCallId: tool.id,
      title,
      summary,
      detail: truncate(formatToolSummary(tool), MAX_DETAIL_LENGTH),
      risk,
      requestedAt: tool.ts,
      options,
      diffAvailable: /diff|edit|write|delete|file/i.test(
        `${tool.title} ${JSON.stringify(tool.args ?? {})}`,
      ),
    };
  }

  return undefined;
}

function extractPlan(events: SessionEvent[]): PlanEntry[] | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const update = extractSessionUpdate(events[index]);
    if (update?.sessionUpdate === "plan" && Array.isArray(update.entries)) {
      return update.entries;
    }
  }
  return null;
}

function collectTools(events: SessionEvent[]): ToolState[] {
  const tools = new Map<string, ToolState>();

  for (const event of events) {
    const update = extractSessionUpdate(event);
    if (!update) continue;
    if (
      update.sessionUpdate !== "tool_call" &&
      update.sessionUpdate !== "tool_call_update"
    ) {
      continue;
    }

    const id = update.toolCallId ?? `${update.title ?? "tool"}-${event.ts}`;
    const existing = tools.get(id);
    const next: ToolState = {
      id,
      title: update.title ?? existing?.title ?? "Agent action",
      status: mapToolStatus(update.status) ?? existing?.status ?? "pending",
      args: update.rawInput ?? existing?.args,
      result: update.rawOutput ?? existing?.result,
      ts: existing?.ts ?? event.ts,
      isAgent:
        existing?.isAgent ??
        (update._meta?.claudeCode?.toolName === "Agent" ||
          update._meta?.claudeCode?.toolName === "Task"),
      parentToolCallId:
        update._meta?.claudeCode?.parentToolCallId ??
        existing?.parentToolCallId,
    };
    tools.set(id, next);
  }

  return [...tools.values()].sort((a, b) => a.ts - b.ts);
}

function buildChecklist(
  plan: PlanEntry[] | null,
  tools: ToolState[],
): WatchTaskChecklistItem[] {
  if (plan?.length) {
    return plan.slice(0, MAX_CHECKLIST_ITEMS).map((entry, index) => ({
      id: `plan-${index}`,
      title: truncate(entry.content, MAX_TITLE_LENGTH) ?? "Task step",
      status: mapPlanStatus(entry.status),
      priority: entry.priority,
      kind: "plan",
      depth: 0,
    }));
  }

  const interestingTools = tools
    .filter(
      (tool) =>
        tool.isAgent || tool.status === "running" || tool.status === "failed",
    )
    .slice(-MAX_CHECKLIST_ITEMS);

  return interestingTools.map((tool) => ({
    id: `tool-${tool.id}`,
    title: truncate(tool.title, MAX_TITLE_LENGTH) ?? "Agent action",
    subtitle: truncate(formatToolSummary(tool), 96),
    status: tool.status,
    kind: tool.isAgent ? "agent" : "tool",
    depth: tool.parentToolCallId ? 1 : 0,
    updatedAt: tool.ts,
  }));
}

function buildTimeline(
  events: SessionEvent[],
  tools: ToolState[],
): WatchTaskTimelineItem[] {
  const timeline: WatchTaskTimelineItem[] = [];
  const seen = new Set<string>();

  const push = (item: WatchTaskTimelineItem) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    timeline.push(item);
  };

  for (const event of events.slice(-80)) {
    const update = extractSessionUpdate(event);
    if (!update) continue;
    switch (update.sessionUpdate) {
      case "agent_message":
        if (update.content?.type === "text") {
          push({
            id: `message-${event.ts}-${timeline.length}`,
            title: truncate(update.content.text, 64) ?? "Agent update",
            kind: "progress",
            timestamp: event.ts,
          });
        }
        break;
      case "tool_call":
        push({
          id: `tool-${update.toolCallId ?? event.ts}`,
          title: truncate(update.title, 64) ?? "Started action",
          detail: truncate(
            update.rawInput
              ? formatToolSummary({
                  id: update.toolCallId ?? "tool",
                  title: update.title ?? "Tool",
                  status: mapToolStatus(update.status),
                  args: update.rawInput,
                  ts: event.ts,
                })
              : undefined,
          ),
          kind: isQuestionTool({
            id: update.toolCallId ?? "tool",
            title: update.title ?? "Tool",
            status: mapToolStatus(update.status),
            args: update.rawInput,
            ts: event.ts,
          })
            ? "approval"
            : "tool",
          timestamp: event.ts,
        });
        break;
      case "plan":
        push({
          id: `plan-${event.ts}`,
          title: "Plan updated",
          detail: `${Array.isArray(update.entries) ? update.entries.length : 0} steps`,
          kind: "progress",
          timestamp: event.ts,
        });
        break;
    }
  }

  for (const tool of tools
    .filter(
      (tool) => tool.status === "failed" || deriveToolRisk(tool) !== "low",
    )
    .slice(-3)) {
    push({
      id: `tool-state-${tool.id}`,
      title: tool.status === "failed" ? "Action failed" : "Risky action",
      detail: truncate(tool.title, MAX_DETAIL_LENGTH),
      kind: tool.status === "failed" ? "failed" : "approval",
      timestamp: tool.ts,
    });
  }

  return timeline
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_TIMELINE_ITEMS);
}

function getCurrentTask(
  checklist: WatchTaskChecklistItem[],
  tools: ToolState[],
): string | undefined {
  const runningPlan = checklist.find((item) => item.status === "running");
  if (runningPlan) return runningPlan.title;
  const runningTool = [...tools]
    .reverse()
    .find((tool) => tool.status === "running" || tool.status === "pending");
  if (runningTool) return truncate(runningTool.title, MAX_TITLE_LENGTH);
  return checklist.find((item) => item.status === "pending")?.title;
}

function deriveStatus(args: {
  session?: TaskSession;
  approval?: WatchTaskApproval;
  progress: WatchTaskProgress;
  isStale: boolean;
  runStatus?: string | null;
}): WatchTaskStatus {
  const { session, approval, isStale, runStatus } = args;
  if (session?.terminalStatus === "failed") return "failed";
  if (session?.terminalStatus === "completed") return "completed";
  if (runStatus === "completed") return "completed";
  if (runStatus === "failed" || runStatus === "cancelled") return "failed";
  if (isStale) return "stale";
  if (approval) return "waiting_for_approval";
  if (session?.status === "connecting") return "connecting";
  if (session?.lastError) return "blocked";
  if (session?.isPromptPending) {
    return "running";
  }
  return "idle";
}

function statusText(status: WatchTaskStatus): string {
  switch (status) {
    case "connecting":
      return "Connecting";
    case "running":
      return "Running";
    case "waiting_for_approval":
      return "Approval needed";
    case "blocked":
      return "Blocked";
    case "failed":
      return "Failed";
    case "completed":
      return "Completed";
    case "stale":
      return "Stale";
    default:
      return "Idle";
  }
}

function allowedActions(
  status: WatchTaskStatus,
  approval?: WatchTaskApproval,
): WatchTaskActionType[] {
  const actions: WatchTaskActionType[] = ["open_phone", "open_mac"];
  if (approval) {
    actions.unshift("reject");
    actions.unshift("approve");
    if (approval.diffAvailable) actions.splice(2, 0, "view_diff");
  }
  if (
    status === "running" ||
    status === "waiting_for_approval" ||
    status === "stale"
  ) {
    actions.push("stop");
  }
  if (status === "failed" || status === "blocked" || status === "stale") {
    actions.push("retry");
  }
  return [...new Set(actions)];
}

export function createWatchTaskSnapshot(
  task: Task,
  session?: TaskSession,
  options: TaskBuildOptions = {},
): WatchTaskSnapshot {
  const now = options.now ?? Date.now();
  const run = task.latest_run;
  const events = session?.events ?? [];
  const plan = extractPlan(events);
  const tools = collectTools(events);
  const checklist = buildChecklist(plan, tools);
  const progress = calculateProgress(checklist);
  const approval = [...tools].reverse().map(extractApproval).find(Boolean);
  const lastEventAt =
    session?.lastEventAt ??
    toMillis(run?.updated_at) ??
    toMillis(task.updated_at) ??
    now;
  const environment = run?.environment ?? "unknown";
  const isStale =
    options.isStale ??
    (environment === "local" &&
      !!session?.isPromptPending &&
      lastEventAt > 0 &&
      now - lastEventAt > STALE_AFTER_MS);
  const status = deriveStatus({
    session,
    approval,
    progress,
    isStale,
    runStatus: run?.status,
  });
  const startedAt =
    toMillis(run?.created_at) ?? toMillis(task.created_at) ?? now;
  const completedAt = toMillis(run?.completed_at);
  const elapsedSeconds = Math.max(
    0,
    Math.floor(((completedAt ?? now) - startedAt) / 1000),
  );
  const currentTask = getCurrentTask(checklist, tools);
  const timeline = buildTimeline(events, tools);
  const taskRunId = session?.taskRunId ?? run?.id;

  if (run?.status === "completed") {
    timeline.unshift({
      id: `completed-${taskRunId ?? task.id}`,
      title: "Run completed",
      kind: "completed",
      timestamp: completedAt ?? now,
    });
  } else if (run?.status === "failed" || session?.terminalStatus === "failed") {
    timeline.unshift({
      id: `failed-${taskRunId ?? task.id}`,
      title: "Run failed",
      detail: truncate(session?.lastError ?? run?.error_message ?? undefined),
      kind: "failed",
      timestamp: completedAt ?? now,
    });
  }

  return {
    schemaVersion: 1,
    id: taskRunId ? `${task.id}:${taskRunId}` : task.id,
    generatedAt: now,
    source:
      environment === "local"
        ? "desktop"
        : environment === "cloud"
          ? "cloud"
          : "mobile",
    taskId: task.id,
    taskRunId,
    taskNumber: task.task_number,
    slug: task.slug,
    title:
      truncate(task.title || task.description, MAX_TITLE_LENGTH) ??
      "PostHog Code task",
    subtitle: truncate(task.description, 96),
    repository: task.repository,
    branch: run?.branch,
    internal: task.internal,
    isArchived: options.isArchived,
    environment,
    status,
    statusText: statusText(status),
    currentTask,
    createdAt: toMillis(task.created_at),
    startedAt,
    updatedAt: toMillis(run?.updated_at) ?? toMillis(task.updated_at),
    completedAt,
    elapsedSeconds,
    progress,
    checklist,
    timeline: timeline.slice(0, MAX_TIMELINE_ITEMS),
    approval,
    blocker:
      status === "failed" || status === "blocked" || status === "stale"
        ? {
            title:
              status === "stale"
                ? "Desktop connection stale"
                : statusText(status),
            detail: truncate(
              options.staleReason ??
                session?.lastError ??
                run?.error_message ??
                undefined,
            ),
            kind: status === "stale" ? "stale" : "error",
          }
        : approval
          ? {
              title: approval.title,
              detail: approval.summary,
              kind: "approval",
            }
          : undefined,
    lastError: session?.lastError ?? run?.error_message ?? null,
    isStale,
    staleReason: isStale
      ? (options.staleReason ?? "No recent updates from the desktop runner.")
      : undefined,
    allowedActions: allowedActions(status, approval),
    handoff: {
      phoneUrl: `posthog://task/${task.id}`,
      macUrl: taskRunId
        ? `posthog-code://task/${task.id}/run/${taskRunId}`
        : `posthog-code://task/${task.id}`,
    },
  };
}

function inboxStatusText(status: SignalReport["status"]): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "pending_input":
      return "Needs input";
    case "in_progress":
      return "Researching";
    case "candidate":
      return "Queued";
    case "potential":
      return "Gathering";
    case "failed":
      return "Failed";
    case "suppressed":
      return "Suppressed";
    case "deleted":
      return "Deleted";
    default:
      return status;
  }
}

function actionabilityText(
  value: SignalReport["actionability"],
): string | undefined {
  switch (value) {
    case "immediately_actionable":
      return "Actionable";
    case "requires_human_input":
      return "Needs input";
    case "not_actionable":
      return "Not actionable";
    default:
      return undefined;
  }
}

function toWatchReviewer(
  reviewer: SuggestedReviewer,
  currentUserUuid?: string,
): WatchInboxSuggestedReviewer {
  const uuid = reviewer.user?.uuid;
  return {
    uuid,
    name:
      reviewer.user?.first_name?.trim() ||
      reviewer.github_name?.trim() ||
      reviewer.github_login,
    githubLogin: reviewer.github_login,
    isMe: !!uuid && uuid === currentUserUuid,
  };
}

export function createWatchInboxReviewers(
  reviewers: AvailableSuggestedReviewer[],
  currentUserUuid?: string,
): WatchInboxReviewer[] {
  const seen = new Set<string>();
  return reviewers
    .filter((reviewer) => {
      if (!reviewer.uuid || seen.has(reviewer.uuid)) return false;
      seen.add(reviewer.uuid);
      return true;
    })
    .map((reviewer) => ({
      uuid: reviewer.uuid,
      name: reviewer.name?.trim() || reviewer.email?.trim() || "Unknown user",
      email: reviewer.email?.trim() || undefined,
      githubLogin: reviewer.github_login?.trim() || undefined,
      isMe: reviewer.uuid === currentUserUuid,
    }))
    .sort((a, b) => {
      if (a.isMe && !b.isMe) return -1;
      if (!a.isMe && b.isMe) return 1;
      return a.name.localeCompare(b.name);
    });
}

export function createWatchInboxReportSnapshot(
  report: SignalReport,
  options: WatchInboxBuildOptions = {},
): WatchInboxReportSnapshot {
  const suggestedReviewers = (options.reviewers ?? []).map((reviewer) =>
    toWatchReviewer(reviewer, options.currentUserUuid),
  );
  const suggestedReviewerUuids = suggestedReviewers
    .map((reviewer) => reviewer.uuid)
    .filter((uuid): uuid is string => !!uuid);
  const isAwaitingInput =
    report.status === "pending_input" ||
    (report.status === "ready" &&
      report.actionability === "requires_human_input");
  const canStartTask =
    isAwaitingInput ||
    (report.status === "ready" &&
      report.actionability === "immediately_actionable" &&
      report.already_addressed !== true);
  const allowedActions: WatchInboxReportAction[] = ["dismiss"];
  if (canStartTask) {
    allowedActions.push(isAwaitingInput ? "implement_as_task" : "start_task");
  }
  allowedActions.push("open_phone");

  return {
    schemaVersion: 1,
    id: report.id,
    title: truncate(report.title, MAX_TITLE_LENGTH) ?? "Untitled signal",
    summary: report.summary ?? undefined,
    status: report.status,
    statusText: inboxStatusText(report.status),
    priority: report.priority,
    actionability: report.actionability,
    actionabilityText: actionabilityText(report.actionability),
    alreadyAddressed: report.already_addressed,
    isSuggestedReviewer: report.is_suggested_reviewer,
    suggestedReviewerUuids,
    suggestedReviewers,
    sourceProducts: report.source_products ?? [],
    signalCount: report.signal_count,
    totalWeight: report.total_weight,
    createdAt: toMillis(report.created_at),
    updatedAt: toMillis(report.updated_at),
    implementationPrUrl: report.implementation_pr_url,
    repository: options.repository ?? undefined,
    allowedActions,
    handoff: {
      phoneUrl: `posthog://report/${report.id}`,
    },
  };
}

export function createWatchAutomationSnapshot(
  automation: TaskAutomation,
  lastTaskRunStatus?: TaskRun["status"] | null,
): WatchAutomationSnapshot {
  const presentation = getAutomationTemplatePresentation(automation);
  const runStatus = getAutomationStatusPresentation({
    lastRunStatus: automation.last_run_status,
    lastTaskRunStatus,
  });

  return {
    schemaVersion: 1,
    id: automation.id,
    name: truncate(automation.name, MAX_TITLE_LENGTH) ?? "Untitled automation",
    prompt: automation.prompt,
    repository: automation.repository || null,
    templateName: presentation.templateName,
    secondaryLabel: presentation.secondaryLabel,
    scheduleSummary: formatAutomationScheduleSummary(automation),
    cronExpression: automation.cron_expression,
    timezone: automation.timezone ?? null,
    enabled: automation.enabled,
    statusText: runStatus.label,
    lastRunStatus: automation.last_run_status,
    lastTaskRunStatus,
    lastRunAt: toMillis(automation.last_run_at),
    lastTaskId: automation.last_task_id,
    lastError: automation.last_error,
    createdAt: toMillis(automation.created_at),
    updatedAt: toMillis(automation.updated_at),
    allowedActions: [
      automation.enabled ? "pause" : "resume",
      "run",
      "open_phone",
    ],
    handoff: {
      phoneUrl: `posthog://automation/${automation.id}`,
    },
  };
}

export function createWatchTaskEnvelope(
  sourceTasks: Task[],
  sessionsByTaskId: Record<string, TaskSession | undefined>,
  activeTaskId?: string,
  options: TaskBuildOptions & {
    archivedTaskIds?: Set<string>;
    isAuthenticated?: boolean;
    inboxReports?: WatchInboxReportSnapshot[];
    inboxReviewers?: WatchInboxReviewer[];
    automations?: WatchAutomationSnapshot[];
  } = {},
): WatchTaskEnvelope {
  const now = options.now ?? Date.now();
  const taskSnapshots = sourceTasks
    .map((task) =>
      createWatchTaskSnapshot(task, sessionsByTaskId[task.id], {
        ...options,
        now,
        isArchived: options.archivedTaskIds?.has(task.id) ?? false,
      }),
    )
    .sort(
      (a, b) => (b.updatedAt ?? b.generatedAt) - (a.updatedAt ?? a.generatedAt),
    );

  return {
    schemaVersion: 1,
    generatedAt: now,
    isAuthenticated: options.isAuthenticated ?? true,
    activeTaskId: taskSnapshots.find(
      (snapshot) => snapshot.taskId === activeTaskId,
    )?.id,
    tasks: taskSnapshots,
    inboxReports: options.inboxReports ?? [],
    inboxReviewers: options.inboxReviewers ?? [],
    automations: options.automations ?? [],
  };
}
