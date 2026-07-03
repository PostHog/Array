import {
  ArrowSquareOutIcon,
  ChatCircleIcon,
  GitBranchIcon,
} from "@phosphor-icons/react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  ChatMessageScroller,
  ChatMessageScrollerButton,
  ChatMessageScrollerContent,
  ChatMessageScrollerItem,
  ChatMessageScrollerProvider,
  ChatMessageScrollerViewport,
  Spinner,
} from "@posthog/quill";
import { formatRelativeTimeShort } from "@posthog/shared";
import type { Task, TaskRunStatus } from "@posthog/shared/domain-types";
import {
  userDisplayName,
  userInitials,
} from "@posthog/ui/features/canvas/components/ThreadPanel";
import { xmlToPlainText } from "@posthog/ui/features/message-editor/content";
import { extractChannelContext } from "@posthog/ui/features/sessions/components/session-update/channelContext";
import { Avatar, Text } from "@radix-ui/themes";
import { useMemo } from "react";

const STATUS_LABELS: Record<TaskRunStatus, string> = {
  not_started: "Not started",
  queued: "Queued",
  in_progress: "In progress",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

function statusBadge(status: TaskRunStatus | undefined) {
  if (!status) return <Badge>Draft</Badge>;
  const variant =
    status === "completed"
      ? "success"
      : status === "failed"
        ? "destructive"
        : status === "in_progress"
          ? "info"
          : "default";
  return (
    <Badge variant={variant}>
      {status === "in_progress" && <Spinner className="size-2.5" />}
      {STATUS_LABELS[status]}
    </Badge>
  );
}

// The prompt as the user typed it: drop the channel CONTEXT.md block the saga
// prepended and flatten the editor XML back to plain text.
function promptText(task: Task): string {
  const raw =
    extractChannelContext(task.description)?.stripped ?? task.description;
  try {
    return xmlToPlainText(raw).trim() || task.title;
  } catch {
    return raw.trim() || task.title;
  }
}

function FeedItem({
  task,
  onOpenTask,
  onOpenThread,
}: {
  task: Task;
  onOpenTask: (task: Task) => void;
  onOpenThread: (task: Task) => void;
}) {
  const prompt = useMemo(() => promptText(task), [task]);
  const prUrl =
    typeof task.latest_run?.output?.pr_url === "string"
      ? task.latest_run.output.pr_url
      : undefined;

  return (
    <div className="group relative flex gap-2.5 px-4 py-2.5 hover:bg-fill-secondary/50">
      <Avatar
        size="2"
        radius="full"
        fallback={userInitials(task.created_by)}
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <Text size="2" weight="medium" className="truncate">
            {userDisplayName(task.created_by)}
          </Text>
          <Text size="1" className="shrink-0 text-muted-foreground">
            {formatRelativeTimeShort(task.created_at)}
          </Text>
        </div>

        <Text
          size="2"
          className="mt-0.5 line-clamp-4 block whitespace-pre-wrap break-words"
        >
          {prompt}
        </Text>

        {/* The task the message kicked off, as a card everyone in the channel sees. */}
        <Card
          size="sm"
          className="mt-2 max-w-xl cursor-pointer transition-colors hover:border-border-primary"
          onClick={() => onOpenTask(task)}
        >
          <CardContent className="flex flex-col gap-1.5 py-2.5">
            <div className="flex items-center gap-2">
              {statusBadge(task.latest_run?.status)}
              {task.latest_run?.stage && (
                <Text size="1" className="text-muted-foreground">
                  {task.latest_run.stage}
                </Text>
              )}
            </div>
            <Text size="2" weight="medium" className="line-clamp-2">
              {task.title || "Untitled task"}
            </Text>
            <div className="flex items-center gap-3">
              {task.repository && (
                <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                  <GitBranchIcon size={12} />
                  {task.repository}
                </span>
              )}
              {prUrl && (
                <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                  <ArrowSquareOutIcon size={12} />
                  PR
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="mt-1">
          <Button
            variant="default"
            size="xs"
            onClick={() => onOpenThread(task)}
            className="opacity-0 transition-opacity group-hover:opacity-100"
          >
            <ChatCircleIcon size={13} />
            Reply in thread
          </Button>
        </div>
      </div>
    </div>
  );
}

// The Slack-style channel feed: every task kicked off in the channel, oldest
// first, rendered as a kickoff message + task card. Multiplayer — the list is
// team-visible and polls for teammates' cards and status flips.
export function ChannelFeedView({
  tasks,
  isLoading,
  emptyState,
  onOpenTask,
  onOpenThread,
}: {
  tasks: Task[];
  isLoading: boolean;
  emptyState?: React.ReactNode;
  onOpenTask: (task: Task) => void;
  onOpenThread: (task: Task) => void;
}) {
  if (isLoading && tasks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (tasks.length === 0) {
    return <div className="flex-1 overflow-y-auto">{emptyState}</div>;
  }

  return (
    <ChatMessageScrollerProvider defaultScrollPosition="end">
      <ChatMessageScroller className="min-h-0 flex-1">
        <ChatMessageScrollerViewport>
          <ChatMessageScrollerContent className="mx-auto w-full max-w-[820px] py-3">
            {tasks.map((task) => (
              <ChatMessageScrollerItem key={task.id} messageId={task.id}>
                <FeedItem
                  task={task}
                  onOpenTask={onOpenTask}
                  onOpenThread={onOpenThread}
                />
              </ChatMessageScrollerItem>
            ))}
          </ChatMessageScrollerContent>
        </ChatMessageScrollerViewport>
        <ChatMessageScrollerButton />
      </ChatMessageScroller>
    </ChatMessageScrollerProvider>
  );
}
