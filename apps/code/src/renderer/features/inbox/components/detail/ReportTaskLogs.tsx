import {
  getTaskPrUrl,
  useReportTasks,
} from "@features/inbox/hooks/useReportTasks";
import { TaskLogsPanel } from "@features/task-detail/components/TaskLogsPanel";
import {
  CaretUpIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  DotOutlineIcon,
  Plus,
  XCircleIcon,
} from "@phosphor-icons/react";
import { Button, Spinner, Text, Tooltip } from "@radix-ui/themes";
import type { SignalReportStatus, SignalReportTask, Task } from "@shared/types";
import { useState } from "react";

type Relationship = SignalReportTask["relationship"];

const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  repo_selection: "Repository selection",
  research: "Research task",
  implementation: "Implementation task",
};

interface BarSummary {
  label: string;
  color: string;
  icon: React.ReactNode;
}

function getTaskStatusSummary(task: Task): BarSummary {
  const status = task.latest_run?.status;
  switch (status) {
    case "queued":
    case "in_progress":
      return {
        label: task.latest_run?.stage
          ? `Running — ${task.latest_run.stage}`
          : "Running…",
        color: "var(--amber-9)",
        icon: <CircleNotchIcon size={14} className="animate-spin" />,
      };
    case "completed":
      return {
        label: "Completed",
        color: "var(--green-9)",
        icon: <CheckCircleIcon size={14} weight="fill" />,
      };
    case "failed":
      return {
        label: "Failed",
        color: "var(--red-9)",
        icon: <XCircleIcon size={14} weight="fill" />,
      };
    case "cancelled":
      return {
        label: "Cancelled",
        color: "var(--gray-9)",
        icon: <XCircleIcon size={14} />,
      };
    default:
      return {
        label: "Queued",
        color: "var(--gray-9)",
        icon: <Spinner size="1" />,
      };
  }
}

function getResearchPendingSummary(
  reportStatus: SignalReportStatus,
  isLoading: boolean,
): { summary: BarSummary; tooltip: string } {
  if (isLoading) {
    return {
      summary: {
        label: "Loading…",
        color: "var(--gray-9)",
        icon: <Spinner size="1" />,
      },
      tooltip: "Checking if a research task exists for this report.",
    };
  }
  if (reportStatus === "candidate") {
    return {
      summary: {
        label: "Queued",
        color: "var(--gray-9)",
        icon: <Spinner size="1" />,
      },
      tooltip:
        "This report has been queued. A repository will be selected and then an AI agent will research it.",
    };
  }
  if (reportStatus === "in_progress") {
    return {
      summary: {
        label: "Starting…",
        color: "var(--amber-9)",
        icon: <CircleNotchIcon size={14} className="animate-spin" />,
      },
      tooltip:
        "An AI research agent is being set up. Logs will appear here once the agent starts running.",
    };
  }
  return {
    summary: {
      label: "Unavailable",
      color: "var(--gray-9)",
      icon: <XCircleIcon size={14} />,
    },
    tooltip:
      "No research task is recorded for this report. It may have been created before research tracking was in place.",
  };
}

const BAR_HEIGHT = 38;

interface Bar {
  relationship: Relationship;
  task: Task | null;
  summary: BarSummary;
  /** Tooltip shown on hover (e.g. pipeline status explanation). */
  tooltip?: string;
  /** When set, render a run-action button with this label instead of (or alongside) the status label. */
  runActionLabel?: string;
  /** PR URL produced by the implementation task, if available. */
  prUrl?: string | null;
  /** ISO timestamp from SignalReportTask.created_at — when this task was started for the report. */
  taskStartedAt?: string;
}

interface ReportTaskLogsProps {
  reportId: string;
  reportStatus: SignalReportStatus;
  /** True when the report is waiting on user input (either `pending_input` status,
   * or `ready` status with `requires_human_input` actionability). */
  isAwaitingInput?: boolean;
  /** Open a prefilled implementation task flow. */
  onCreateImplementationTask?: () => void;
}

export function ReportTaskLogs({
  reportId,
  reportStatus,
  isAwaitingInput = false,
  onCreateImplementationTask,
}: ReportTaskLogsProps) {
  const { data, isLoading } = useReportTasks(reportId, reportStatus);
  const [expanded, setExpanded] = useState<Relationship | null>(null);

  const tasks = data ?? [];
  const researchTaskData = tasks.find((t) => t.relationship === "research");
  const implementationTaskData = tasks.find(
    (t) => t.relationship === "implementation",
  );
  const researchTask = researchTaskData?.task ?? null;
  const implementationTask = implementationTaskData?.task ?? null;

  const prUrl = implementationTask ? getTaskPrUrl(implementationTask) : null;

  // Build the stacked bars we'll render. We always surface the research bar
  // (using a pending/unavailable placeholder if no research task exists yet).
  // For `ready` reports without an implementation task yet, we still show the
  // implementation row ("Not started"); the run-action control only appears
  // when the parent passes `onCreateImplementationTask`. For `pending_input` reports, we
  // surface the control as "Provide input for PR" so the user can supply the
  // additional context the agent is waiting on.
  const bars: Bar[] = [];

  if (researchTask) {
    bars.push({
      relationship: "research",
      task: researchTask,
      summary: getTaskStatusSummary(researchTask),
      taskStartedAt: researchTaskData?.startedAt,
    });
  } else {
    const { summary, tooltip } = getResearchPendingSummary(
      reportStatus,
      isLoading,
    );
    bars.push({
      relationship: "research",
      task: null,
      summary,
      tooltip,
    });
  }

  const isPendingInput = reportStatus === "pending_input";
  const awaitingInput = isPendingInput || isAwaitingInput;
  const runActionLabel = onCreateImplementationTask
    ? awaitingInput
      ? "Implement as new task"
      : "Create PR"
    : undefined;

  if (implementationTask) {
    bars.push({
      relationship: "implementation",
      task: implementationTask,
      summary: getTaskStatusSummary(implementationTask),
      prUrl,
      runActionLabel: awaitingInput ? runActionLabel : undefined,
      taskStartedAt: implementationTaskData?.startedAt,
    });
  } else if (reportStatus === "ready" || isPendingInput) {
    bars.push({
      relationship: "implementation",
      task: null,
      summary: {
        label: "Not started",
        color: "var(--gray-9)",
        icon: <DotOutlineIcon size={14} />,
      },
      runActionLabel,
    });
  }

  // Hide entirely when the report isn't actionable (e.g. POTENTIAL) and we
  // have no tasks to show — matches the previous behavior.
  const showBar =
    isLoading ||
    tasks.length > 0 ||
    reportStatus === "candidate" ||
    reportStatus === "in_progress" ||
    reportStatus === "ready" ||
    isPendingInput;

  if (!showBar) {
    return null;
  }

  const expandedBar = expanded
    ? (bars.find((b) => b.relationship === expanded && b.task) ?? null)
    : null;
  const totalBarsHeight = BAR_HEIGHT * bars.length;

  return (
    <>
      {/* In-flow spacer — same height as the stacked bars. */}
      <div
        className="shrink-0 border-gray-5 border-t"
        style={{ height: totalBarsHeight }}
      />

      {/* Scrim — biome-ignore: scrim is a non-semantic dismissal target */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: scrim dismiss */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: scrim dismiss */}
      <div
        onClick={expandedBar ? () => setExpanded(null) : undefined}
        style={{
          background: "rgba(0, 0, 0, 0.32)",
          opacity: expandedBar ? 1 : 0,
          transition: "opacity 0.2s ease",
          pointerEvents: expandedBar ? "auto" : "none",
        }}
        className="absolute inset-0 z-10"
      />

      {/* Sliding card — animates `top` to avoid a Chromium layout
          bug with `transform` on absolute elements in flex+scroll. */}
      <div
        style={{
          zIndex: 11,
          top: expandedBar ? "15%" : `calc(100% - ${totalBarsHeight}px)`,
          transition: "top 0.25s cubic-bezier(0.32, 0.72, 0, 1)",
        }}
        className="pointer-events-none absolute right-0 bottom-0 left-0 flex flex-col border-t border-t-(--gray-6) bg-(--color-background)"
      >
        {/* Stacked header bars — one per task relationship. */}
        <div className="pointer-events-auto shrink-0">
          {bars.map((bar, index) => {
            const {
              relationship,
              task,
              summary,
              tooltip,
              runActionLabel,
              taskStartedAt,
            } = bar;
            const showRunAction = !!runActionLabel;
            const isExpanded = expanded === relationship;
            const isInteractive = !!task;
            // When we have both an expandable task and a run button, the outer
            // element becomes a <div role="button"> so we can legally nest the
            // run button inside. Without a task, there's nothing to expand; the
            // run button becomes the sole interactive control.
            const hideStatusLabel = showRunAction && !task;

            const rowClassName = [
              "flex w-full items-center gap-2 bg-transparent px-2 @md:px-3 @lg:px-4 @xl:px-5 @2xl:px-6 @3xl:px-8 @4xl:px-10 @5xl:px-12 py-2 text-left transition-colors",
              index > 0 ? "border-gray-5 border-t" : "",
              isInteractive
                ? "cursor-pointer hover:bg-gray-2"
                : showRunAction
                  ? "cursor-default"
                  : "cursor-default opacity-70",
              isExpanded && isInteractive ? "bg-gray-2" : "",
            ]
              .filter(Boolean)
              .join(" ");

            const toggleExpand = () =>
              setExpanded((curr) =>
                curr === relationship ? null : relationship,
              );

            const rowInner = (
              <>
                <span style={{ color: summary.color }}>{summary.icon}</span>
                <Text className="font-medium text-[12px]">
                  {RELATIONSHIP_LABELS[relationship]}
                </Text>
                {hideStatusLabel ? (
                  <span className="flex-1" />
                ) : (
                  <Text
                    className="flex-1 text-[11px]"
                    style={{ color: summary.color }}
                  >
                    {taskStartedAt ? (
                      <Tooltip
                        content={`Started ${new Date(taskStartedAt).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}`}
                      >
                        <span className="cursor-help">
                          {bar.prUrl
                            ? summary.label
                            : relationship === "implementation" &&
                                (task?.latest_run?.status === "queued" ||
                                  task?.latest_run?.status === "in_progress")
                              ? "Working on a PR…"
                              : summary.label}
                        </span>
                      </Tooltip>
                    ) : bar.prUrl ? (
                      summary.label
                    ) : relationship === "implementation" &&
                      (task?.latest_run?.status === "queued" ||
                        task?.latest_run?.status === "in_progress") ? (
                      "Working on a PR…"
                    ) : (
                      summary.label
                    )}
                  </Text>
                )}
                {showRunAction && (
                  <Button
                    size="1"
                    variant="solid"
                    className="gap-1 font-medium text-[11px]"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCreateImplementationTask?.();
                    }}
                  >
                    <Plus size={12} />
                    {runActionLabel}
                  </Button>
                )}
                {isInteractive && (
                  <span
                    className="inline-flex text-gray-9"
                    style={{
                      transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 0.2s ease",
                    }}
                  >
                    <CaretUpIcon size={12} />
                  </span>
                )}
              </>
            );

            const row = isInteractive ? (
              showRunAction ? (
                // biome-ignore lint/a11y/useSemanticElements: a <button> can't contain the nested run-action <button>
                <div
                  key={relationship}
                  role="button"
                  tabIndex={0}
                  onClick={toggleExpand}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleExpand();
                    }
                  }}
                  className={rowClassName}
                  style={{ height: BAR_HEIGHT }}
                >
                  {rowInner}
                </div>
              ) : (
                <button
                  key={relationship}
                  type="button"
                  onClick={toggleExpand}
                  className={rowClassName}
                  style={{ height: BAR_HEIGHT }}
                >
                  {rowInner}
                </button>
              )
            ) : (
              <div
                key={relationship}
                className={rowClassName}
                style={{ height: BAR_HEIGHT }}
              >
                {rowInner}
              </div>
            );

            return tooltip ? (
              <Tooltip key={relationship} content={tooltip}>
                {row}
              </Tooltip>
            ) : (
              row
            );
          })}
        </div>

        {/* Expanded logs body — only rendered for the selected task. */}
        <div
          style={{
            pointerEvents: expandedBar ? "auto" : "none",
          }}
          className="min-h-0 flex-1 overflow-hidden"
        >
          {expandedBar?.task && (
            <TaskLogsPanel
              key={expandedBar.task.id}
              taskId={expandedBar.task.id}
              task={expandedBar.task}
              hideInput={reportStatus !== "ready"}
            />
          )}
        </div>
      </div>
    </>
  );
}
