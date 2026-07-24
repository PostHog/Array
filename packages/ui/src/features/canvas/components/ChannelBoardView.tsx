import {
  ChatCircleIcon,
  CheckCircle,
  Eye,
  GitCommit,
  XCircle,
} from "@phosphor-icons/react";
import type { PrSnapshot } from "@posthog/core/home/prSnapshot";
import {
  TASK_BOARD_STATUSES,
  type TaskBoardStatus,
  taskBoardStatusFromSources,
} from "@posthog/core/tasks/taskBoardStatus";
import type { Task } from "@posthog/shared/domain-types";
import { UserAvatar } from "@posthog/ui/features/auth/UserAvatar";
import {
  TaskStatusBadge,
  useTaskStatusDisplay,
} from "@posthog/ui/features/canvas/components/ChannelFeedView";
import { ChannelPrButton } from "@posthog/ui/features/canvas/components/ChannelPrButton";
import {
  type ChannelTaskPrStates,
  taskPrUrl,
} from "@posthog/ui/features/canvas/hooks/useChannelTaskPrStates";
import { useTaskThread } from "@posthog/ui/features/canvas/hooks/useTaskThread";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import type { SidebarPrState } from "@posthog/ui/features/sidebar/useTaskPrStatus";
import { useInView } from "@posthog/ui/primitives/hooks/useInView";
import {
  WorkBoard,
  type WorkBoardColor,
  type WorkBoardColumn,
} from "@posthog/ui/primitives/WorkBoard";
import { Box } from "@radix-ui/themes";
import { useMemo } from "react";

const BOARD_REPLIES_POLL_INTERVAL_MS = 15_000;
const PR_BADGE_STATE_BY_STATUS: Record<
  TaskBoardStatus,
  Exclude<SidebarPrState, null>
> = {
  working: "draft",
  in_review: "open",
  done: "merged",
  cancelled: "closed",
};
const STATUS_VISUAL: Record<
  TaskBoardStatus,
  {
    label: string;
    description: string;
    color: WorkBoardColor;
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
    description: "Open, non-draft PR ready for review",
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
  taskPrStates,
  onOpenTask,
  onOpenThread,
}: {
  tasks: Task[];
  isLoading: boolean;
  prSnapshotByTaskId: ReadonlyMap<string, PrSnapshot>;
  taskPrStates: ChannelTaskPrStates;
  onOpenTask: (task: Task) => void;
  onOpenThread: (task: Task) => void;
}) {
  const columns = useMemo<
    WorkBoardColumn<{
      task: Task;
      status: TaskBoardStatus;
      prState: SidebarPrState;
      badgePrState: SidebarPrState;
    }>[]
  >(() => {
    const grouped = new Map<
      TaskBoardStatus,
      Array<{
        task: Task;
        status: TaskBoardStatus;
        prState: SidebarPrState;
        badgePrState: SidebarPrState;
      }>
    >(TASK_BOARD_STATUSES.map((status) => [status, []]));
    for (const task of tasks) {
      // A task with a PR cannot be classified until its first PR response.
      // Omitting it temporarily avoids showing it as Working and then moving it.
      if (taskPrStates.pendingTaskIds.has(task.id)) continue;
      const snapshot = prSnapshotByTaskId.get(task.id);
      const resolvedPrState = taskPrStates.states.get(task.id);
      const status = taskBoardStatusFromSources({
        runStatus: task.latest_run?.status,
        resolvedPrState,
        prSnapshot: snapshot,
      });
      const prState = resolvedPrState ?? snapshot?.state ?? null;
      grouped.get(status)?.push({
        task,
        status,
        prState,
        badgePrState:
          prState === PR_BADGE_STATE_BY_STATUS[status] ? prState : null,
      });
    }
    return TASK_BOARD_STATUSES.map((status) => ({
      id: status,
      ...STATUS_VISUAL[status],
      items: grouped.get(status) ?? [],
    }));
  }, [prSnapshotByTaskId, taskPrStates, tasks]);

  if (isLoading) {
    return <div className="min-h-0 flex-1" />;
  }

  return (
    <WorkBoard
      columns={columns}
      isLoading={taskPrStates.isResolving}
      getKey={(item) => item.task.id}
      renderCard={({ task, status, prState, badgePrState }) => (
        <ChannelBoardCard
          task={task}
          status={status}
          prState={prState}
          badgePrState={badgePrState}
          prUrl={taskPrUrl(task, prSnapshotByTaskId) ?? undefined}
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
  prState,
  badgePrState,
  prUrl,
  onOpenTask,
  onOpenThread,
}: {
  task: Task;
  status: TaskBoardStatus;
  prState: SidebarPrState;
  badgePrState: SidebarPrState;
  prUrl?: string;
  onOpenTask: (task: Task) => void;
  onOpenThread: (task: Task) => void;
}) {
  const taskDisplay = useTaskStatusDisplay(task);
  const display = badgePrState
    ? {
        base: null,
        prState: badgePrState,
        isMerged: badgePrState === "merged",
      }
    : taskDisplay;
  const [cardRef, inView] = useInView<HTMLDivElement>({
    rootMargin: "1200px 0px",
  });
  const { messages } = useTaskThread(task.id, {
    pollIntervalMs: BOARD_REPLIES_POLL_INTERVAL_MS,
    enabled: inView,
  });
  const creatorName = userDisplayName(task.created_by);
  const visual = STATUS_VISUAL[status];
  const replyLabel = `${messages.length} ${messages.length === 1 ? "reply" : "replies"}`;

  return (
    <Box
      ref={cardRef}
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
      {prUrl ? <ChannelPrButton prUrl={prUrl} prState={prState} /> : null}
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
