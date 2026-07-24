import { ChatCircleIcon, GitPullRequest } from "@phosphor-icons/react";
import type { SituationId } from "@posthog/core/workflow/schemas";
import { Button } from "@posthog/quill";
import type { Task } from "@posthog/shared/domain-types";
import { UserAvatar } from "@posthog/ui/features/auth/UserAvatar";
import {
  TaskStatusBadge,
  useTaskStatusDisplay,
} from "@posthog/ui/features/canvas/components/ChannelFeedView";
import { useTaskThread } from "@posthog/ui/features/canvas/hooks/useTaskThread";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import {
  WorkBoard,
  type WorkBoardColumn,
} from "@posthog/ui/features/home/components/WorkBoard";
import { HOME_BOARD_COLUMN_IDS } from "@posthog/ui/features/home/utils/boardColumns";
import { SITUATION_VISUAL } from "@posthog/ui/features/home/utils/situationDisplay";
import { openUrlInBrowser } from "@posthog/ui/utils/browser";
import { Box } from "@radix-ui/themes";
import { useMemo } from "react";

const BOARD_REPLIES_POLL_INTERVAL_MS = 15_000;
export function ChannelBoardView({
  tasks,
  isLoading,
  situationByTaskId,
  prUrlByTaskId,
  onOpenTask,
  onOpenThread,
}: {
  tasks: Task[];
  isLoading: boolean;
  situationByTaskId: ReadonlyMap<string, SituationId>;
  prUrlByTaskId: ReadonlyMap<string, string>;
  onOpenTask: (task: Task) => void;
  onOpenThread: (task: Task) => void;
}) {
  const columns = useMemo<WorkBoardColumn<Task>[]>(() => {
    const grouped = new Map<SituationId, Task[]>(
      HOME_BOARD_COLUMN_IDS.map((id) => [id, []]),
    );
    for (const task of tasks) {
      const situation = situationByTaskId.get(task.id);
      if (situation) grouped.get(situation)?.push(task);
    }
    return HOME_BOARD_COLUMN_IDS.map((id) => ({
      id,
      label: SITUATION_VISUAL[id].label,
      description: SITUATION_VISUAL[id].description,
      color: SITUATION_VISUAL[id].color,
      Icon: SITUATION_VISUAL[id].Icon,
      items: grouped.get(id) ?? [],
    }));
  }, [situationByTaskId, tasks]);

  if (isLoading) {
    return <div className="min-h-0 flex-1" />;
  }

  return (
    <WorkBoard
      columns={columns}
      getKey={(task) => task.id}
      renderCard={(task) => (
        <ChannelBoardCard
          task={task}
          homeSituation={situationByTaskId.get(task.id)}
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
  homeSituation,
  prUrl,
  onOpenTask,
  onOpenThread,
}: {
  task: Task;
  homeSituation?: SituationId;
  prUrl?: string;
  onOpenTask: (task: Task) => void;
  onOpenThread: (task: Task) => void;
}) {
  const display = useTaskStatusDisplay(task);
  const { messages } = useTaskThread(task.id, {
    pollIntervalMs: BOARD_REPLIES_POLL_INTERVAL_MS,
  });
  const creatorName = userDisplayName(task.created_by);
  const visual = SITUATION_VISUAL[homeSituation ?? "working"];
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
