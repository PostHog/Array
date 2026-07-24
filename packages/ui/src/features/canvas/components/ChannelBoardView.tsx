import {
  ChatCircleIcon,
  CheckCircle,
  Eye,
  GitCommit,
  GitPullRequest,
  XCircle,
} from "@phosphor-icons/react";
import type { PrSnapshot } from "@posthog/core/home/prSnapshot";
import {
  TASK_BOARD_STATUSES,
  type TaskBoardStatus,
  taskBoardStatus,
} from "@posthog/core/home/taskBoardStatus";
import { Button } from "@posthog/quill";
import type { Task } from "@posthog/shared/domain-types";
import { UserAvatar } from "@posthog/ui/features/auth/UserAvatar";
import {
  TaskStatusBadge,
  useTaskStatusDisplay,
} from "@posthog/ui/features/canvas/components/ChannelFeedView";
import { useChannelTaskPrStates } from "@posthog/ui/features/canvas/hooks/useChannelTaskPrStates";
import { useTaskThread } from "@posthog/ui/features/canvas/hooks/useTaskThread";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import {
  WorkBoard,
  type WorkBoardColumn,
} from "@posthog/ui/features/home/components/WorkBoard";
import type { SituationColor } from "@posthog/ui/features/home/utils/situationDisplay";
import { openUrlInBrowser } from "@posthog/ui/utils/browser";
import { Box } from "@radix-ui/themes";
import { useMemo } from "react";

const BOARD_REPLIES_POLL_INTERVAL_MS = 15_000;
const STATUS_VISUAL: Record<
  TaskBoardStatus,
  {
    label: string;
    description: string;
    color: SituationColor;
    Icon: typeof GitCommit;
  }
> = {
  working: {
    label: "Working",
    description: "No PR, draft PR, or CI is not passing",
    color: "purple",
    Icon: GitCommit,
  },
  in_review: {
    label: "In review",
    description: "Open PR with passing CI",
    color: "blue",
    Icon: Eye,
  },
  done: {
    label: "Done",
    description: "PR merged",
    color: "gray",
    Icon: CheckCircle,
  },
  cancelled: {
    label: "Cancelled",
    description: "PR closed or task failed/cancelled",
    color: "red",
    Icon: XCircle,
  },
};

export function ChannelBoardView({
  tasks,
  isLoading,
  prSnapshotByTaskId,
  prUrlByTaskId,
  onOpenTask,
  onOpenThread,
}: {
  tasks: Task[];
  isLoading: boolean;
  prSnapshotByTaskId: ReadonlyMap<string, PrSnapshot>;
  prUrlByTaskId: ReadonlyMap<string, string>;
  onOpenTask: (task: Task) => void;
  onOpenThread: (task: Task) => void;
}) {
  const prStates = useChannelTaskPrStates(tasks);
  const columns = useMemo<
    WorkBoardColumn<{ task: Task; status: TaskBoardStatus }>[]
  >(() => {
    const grouped = new Map<
      TaskBoardStatus,
      Array<{ task: Task; status: TaskBoardStatus }>
    >(TASK_BOARD_STATUSES.map((status) => [status, []]));
    for (const task of tasks) {
      const snapshot = prSnapshotByTaskId.get(task.id);
      const status = taskBoardStatus({
        runStatus: task.latest_run?.status,
        prState: snapshot?.state ?? prStates.get(task.id),
        ciStatus: snapshot?.ciStatus,
      });
      grouped.get(status)?.push({ task, status });
    }
    return TASK_BOARD_STATUSES.map((status) => ({
      id: status,
      ...STATUS_VISUAL[status],
      items: grouped.get(status) ?? [],
    }));
  }, [prSnapshotByTaskId, prStates, tasks]);

  if (isLoading) {
    return <div className="min-h-0 flex-1" />;
  }

  return (
    <WorkBoard
      columns={columns}
      getKey={(item) => item.task.id}
      renderCard={({ task, status }) => (
        <ChannelBoardCard
          task={task}
          status={status}
          prUrl={
            prUrlByTaskId.get(task.id) ??
            (typeof task.latest_run?.output?.pr_url === "string"
              ? task.latest_run.output.pr_url
              : undefined)
          }
          onOpenTask={onOpenTask}
          onOpenThread={onOpenThread}
        />
      )}
    />
  );
}

function ChannelBoardCard({
  task,
  status,
  prUrl,
  onOpenTask,
  onOpenThread,
}: {
  task: Task;
  status: TaskBoardStatus;
  prUrl?: string;
  onOpenTask: (task: Task) => void;
  onOpenThread: (task: Task) => void;
}) {
  const display = useTaskStatusDisplay(task);
  const { messages } = useTaskThread(task.id, {
    pollIntervalMs: BOARD_REPLIES_POLL_INTERVAL_MS,
  });
  const creatorName = userDisplayName(task.created_by);
  const visual = STATUS_VISUAL[status];
  const replyLabel = `${messages.length} ${messages.length === 1 ? "reply" : "replies"}`;

  return (
    <Box
      role="button"
      tabIndex={0}
      aria-label={`Open ${task.title || "Untitled task"}`}
      onClick={() => onOpenTask(task)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenTask(task);
        }
      }}
      className="group hover:-translate-y-px relative flex cursor-pointer flex-col gap-2 overflow-hidden rounded-lg border border-(--gray-4) bg-(--color-panel-solid) px-3 pt-3 pb-2.5 transition-all hover:border-(--gray-7) hover:shadow-md"
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ backgroundColor: `var(--${visual.color}-9)` }}
      />
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 font-medium text-[13px] text-gray-12 leading-snug">
          {task.title || "Untitled task"}
        </span>
        <TaskStatusBadge display={display} />
      </div>
      {task.repository ? (
        <span className="truncate text-(--gray-10) text-[11px]">
          {task.repository}
        </span>
      ) : null}
      {prUrl ? (
        <Button
          variant="outline"
          size="xs"
          className="w-fit"
          onClick={(event) => {
            event.stopPropagation();
            void openUrlInBrowser(prUrl);
          }}
        >
          <GitPullRequest size={11} />
          View PR
        </Button>
      ) : null}
      <div className="mt-1.5 flex items-center justify-between gap-2 border-(--gray-3) border-t pt-2.5">
        <div className="flex min-w-0 items-center gap-1.5" title={creatorName}>
          <UserAvatar user={task.created_by} size="xs" />
          <span className="truncate text-(--gray-10) text-[11px]">
            {creatorName}
          </span>
        </div>
        <button
          type="button"
          className="flex shrink-0 items-center gap-1 text-(--gray-10) text-[11px] hover:text-gray-12"
          onClick={(event) => {
            event.stopPropagation();
            onOpenThread(task);
          }}
        >
          <ChatCircleIcon size={13} />
          {replyLabel}
        </button>
      </div>
    </Box>
  );
}
