import {
  ChatCircleIcon,
  ChatTeardropTextIcon,
  CheckCircleIcon,
  SpinnerGapIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { Button, Card, CardContent, cn } from "@posthog/quill";
import type { Task } from "@posthog/shared/domain-types";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { UserAvatar } from "@posthog/ui/features/auth/UserAvatar";
import { useCurrentUser } from "@posthog/ui/features/auth/useCurrentUser";
import {
  TaskStatusBadge,
  useTaskStatusDisplay,
} from "@posthog/ui/features/canvas/components/ChannelFeedView";
import { useChannelFeedbackRequest } from "@posthog/ui/features/canvas/hooks/useChannelFeedbackRequest";
import { useTaskThread } from "@posthog/ui/features/canvas/hooks/useTaskThread";
import type { ChannelBoardStatus } from "@posthog/ui/features/canvas/utils/channelBoardStatus";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import { toast } from "@posthog/ui/primitives/toast";
import { ScrollArea } from "@radix-ui/themes";

const BOARD_REPLIES_POLL_INTERVAL_MS = 15_000;

const COLUMNS: Array<{
  id: ChannelBoardStatus;
  label: string;
  Icon: typeof SpinnerGapIcon;
}> = [
  { id: "in_progress", label: "In progress", Icon: SpinnerGapIcon },
  {
    id: "needs_feedback",
    label: "Needs feedback",
    Icon: ChatTeardropTextIcon,
  },
  { id: "ready", label: "Ready", Icon: CheckCircleIcon },
  { id: "closed", label: "Closed", Icon: XCircleIcon },
];

export function ChannelBoardView({
  tasks,
  isLoading,
  onOpenTask,
  onOpenThread,
}: {
  tasks: Task[];
  isLoading: boolean;
  onOpenTask: (task: Task) => void;
  onOpenThread: (task: Task) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <SpinnerGapIcon className="animate-spin" size={20} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
      {COLUMNS.map((column) => (
        <BoardColumn
          key={column.id}
          column={column}
          tasks={tasks}
          onOpenTask={onOpenTask}
          onOpenThread={onOpenThread}
        />
      ))}
    </div>
  );
}

function BoardColumn({
  column,
  tasks,
  onOpenTask,
  onOpenThread,
}: {
  column: (typeof COLUMNS)[number];
  tasks: Task[];
  onOpenTask: (task: Task) => void;
  onOpenThread: (task: Task) => void;
}) {
  return (
    <div className="flex h-full min-h-0 w-[300px] shrink-0 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <column.Icon
          size={14}
          weight="bold"
          className="text-muted-foreground"
        />
        <span className="font-semibold text-[12px] text-gray-12">
          {column.label}
        </span>
      </div>
      <div className="min-h-0 flex-1 rounded-xl border border-(--gray-3) bg-(--gray-2)">
        <ScrollArea scrollbars="vertical" className="h-full min-h-0">
          <div className="flex flex-col gap-2 p-2">
            {tasks.map((task) => (
              <ChannelBoardCardFilter
                key={task.id}
                task={task}
                status={column.id}
                onOpenTask={onOpenTask}
                onOpenThread={onOpenThread}
              />
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function ChannelBoardCardFilter({
  task,
  status,
  onOpenTask,
  onOpenThread,
}: {
  task: Task;
  status: ChannelBoardStatus;
  onOpenTask: (task: Task) => void;
  onOpenThread: (task: Task) => void;
}) {
  const display = useTaskStatusDisplay(task);
  if (display.boardStatus !== status) return null;
  return (
    <ChannelBoardCard
      task={task}
      display={display}
      onOpenTask={onOpenTask}
      onOpenThread={onOpenThread}
    />
  );
}

function ChannelBoardCard({
  task,
  display,
  onOpenTask,
  onOpenThread,
}: {
  task: Task;
  display: ReturnType<typeof useTaskStatusDisplay>;
  onOpenTask: (task: Task) => void;
  onOpenThread: (task: Task) => void;
}) {
  const { messages } = useTaskThread(task.id, {
    pollIntervalMs: BOARD_REPLIES_POLL_INTERVAL_MS,
  });
  const creator = task.created_by;
  const creatorName = userDisplayName(creator);
  const client = useOptionalAuthenticatedClient();
  const { data: currentUser } = useCurrentUser({ client });
  const { setNeedsFeedback, isPending } = useChannelFeedbackRequest();
  const isCreator =
    !!currentUser?.uuid && currentUser.uuid === task.created_by?.uuid;
  const needsFeedback = display.boardStatus === "needs_feedback";
  const canRequestFeedback =
    isCreator &&
    !!task.latest_run &&
    (display.boardStatus === "ready" || needsFeedback);
  const replyLabel = `${messages.length} ${messages.length === 1 ? "reply" : "replies"}`;

  const toggleFeedbackRequest = (value: boolean) => {
    void setNeedsFeedback(task, value).catch((error: unknown) => {
      toast.error("Couldn't update feedback request", {
        description: error instanceof Error ? error.message : String(error),
      });
    });
  };

  return (
    <Card
      size="sm"
      role="button"
      tabIndex={0}
      onClick={() => onOpenTask(task)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenTask(task);
        }
      }}
      className={cn(
        "cursor-pointer py-0 hover:border-border-primary hover:bg-fill-hover",
        display.isMerged && "border-(--purple-8) bg-(--purple-a2)",
      )}
    >
      <CardContent className="flex flex-col gap-2 py-3">
        <div className="flex items-start justify-between gap-2">
          <span className="line-clamp-2 font-medium text-sm">
            {task.title || "Untitled task"}
          </span>
          <TaskStatusBadge display={display} />
        </div>
        {task.repository ? (
          <span
            className="truncate text-muted-foreground text-xs"
            title={task.repository}
          >
            {task.repository}
          </span>
        ) : null}
        {canRequestFeedback ? (
          <Button
            size="xs"
            variant={needsFeedback ? "outline" : "link-muted"}
            disabled={isPending}
            onClick={(event) => {
              event.stopPropagation();
              toggleFeedbackRequest(!needsFeedback);
            }}
          >
            <ChatTeardropTextIcon size={12} />
            {needsFeedback ? "Clear feedback request" : "Request feedback"}
          </Button>
        ) : null}
        <div className="flex items-center justify-between gap-2 border-(--gray-3) border-t pt-2">
          <div
            className="flex min-w-0 items-center gap-1.5"
            title={creatorName}
          >
            <UserAvatar user={creator} size="xs" />
            <span className="truncate text-muted-foreground text-xs">
              {creatorName}
            </span>
          </div>
          <button
            type="button"
            className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              onOpenThread(task);
            }}
          >
            <ChatCircleIcon size={13} />
            {replyLabel}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
