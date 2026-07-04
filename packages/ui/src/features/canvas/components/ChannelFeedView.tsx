import {
  ArrowSquareOutIcon,
  ChatCircleIcon,
  GitBranchIcon,
  RobotIcon,
  UserIcon,
} from "@phosphor-icons/react";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  Badge,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  ChatMessage,
  ChatMessageAvatar,
  ChatMessageContent,
  ChatMessageHeader,
  ChatMessageScroller,
  ChatMessageScrollerButton,
  ChatMessageScrollerContent,
  ChatMessageScrollerItem,
  ChatMessageScrollerProvider,
  ChatMessageScrollerViewport,
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@posthog/quill";
import { formatRelativeTimeShort } from "@posthog/shared";
import type { Task, TaskRunStatus } from "@posthog/shared/domain-types";
import { isTerminalStatus } from "@posthog/shared/domain-types";
import { getUserInitials } from "@posthog/ui/features/auth/userInitials";
import { TaskTabIcon } from "@posthog/ui/features/browser-tabs/TaskTabIcon";
import { useChannelTaskData } from "@posthog/ui/features/canvas/hooks/useChannelTaskData";
import { useTaskThread } from "@posthog/ui/features/canvas/hooks/useTaskThread";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import { xmlToPlainText } from "@posthog/ui/features/message-editor/content";
import { extractChannelContext } from "@posthog/ui/features/sessions/components/session-update/channelContext";
import { getOriginProductMeta } from "@posthog/ui/features/sidebar/components/items/TaskIcon";
import { Text } from "@radix-ui/themes";
import { useMemo } from "react";

// Feed rows poll their reply counts slower than the open thread panel — the
// shared query key means an open panel naturally speeds the row up too.
const FEED_REPLIES_POLL_INTERVAL_MS = 15_000;

const STATUS_LABELS: Record<TaskRunStatus, string> = {
  not_started: "Not started",
  queued: "Queued",
  in_progress: "In progress",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

function statusBadge(status: TaskRunStatus) {
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

// Live status for the card, derived the same way the sidebar's TaskIcon does
// (via useChannelTaskData: local session + workspace + cloud run). The raw
// `latest_run.status` alone is wrong for local runs — the backend row often
// stays "queued" while the agent runs on the creator's machine — so it is
// only trusted for cloud runs and terminal states (which imply a sync).
function TaskStatusBadge({ task }: { task: Task }) {
  const data = useChannelTaskData(task);
  if (data?.needsPermission)
    return <Badge variant="warning">Needs input</Badge>;
  if (data?.isGenerating) {
    return (
      <Badge variant="info">
        <Spinner className="size-2.5" />
        In progress
      </Badge>
    );
  }
  const status = data?.taskRunStatus ?? task.latest_run?.status;
  const environment = data?.taskRunEnvironment ?? task.latest_run?.environment;
  if (!status) return <Badge>Draft</Badge>;
  if (environment === "cloud" || isTerminalStatus(status)) {
    return statusBadge(status);
  }
  return <Badge>Local</Badge>;
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

// The card's context line, mirroring the storybook feed: who/what kicked the
// task off ("Requested by @Ann" for humans, the origin product otherwise).
function TaskCardOrigin({ task }: { task: Task }) {
  const isUserCreated = task.origin_product === "user_created";
  const label = isUserCreated
    ? `Requested by @${userDisplayName(task.created_by)}`
    : (getOriginProductMeta(task.origin_product)?.label ?? task.origin_product);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
      {isUserCreated ? <UserIcon size={12} /> : <RobotIcon size={12} />}
      <span className="truncate">{label}</span>
    </span>
  );
}

// The task the message kicked off, as a card everyone in the channel sees:
// origin + status up top, bold title, then run metadata.
function TaskCard({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const prUrl =
    typeof task.latest_run?.output?.pr_url === "string"
      ? task.latest_run.output.pr_url
      : undefined;
  // The repository renders separately with its icon; `meta` is the plain-text
  // remainder of the row.
  const meta = [
    task.slug || null,
    task.latest_run?.stage ?? null,
    task.latest_run?.environment === "cloud" ? "Cloud" : null,
  ].filter(Boolean) as string[];

  return (
    <Card
      size="sm"
      className="mt-1.5 w-full cursor-pointer transition-colors hover:border-border-primary"
      onClick={onOpen}
    >
      <CardContent className="flex flex-col gap-1 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <TaskCardOrigin task={task} />
          <TaskStatusBadge task={task} />
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          {/* Same live status icon as the code side nav, so the card and the
              nav never disagree (generating spinner, needs-permission, cloud
              status colors, PR state). */}
          <TaskTabIcon task={task} size={14} />
          <Text size="2" weight="medium" className="line-clamp-2">
            {task.title || "Untitled task"}
          </Text>
        </div>
        {(meta.length > 0 || task.repository || prUrl) && (
          <div className="flex min-w-0 items-center gap-3">
            {task.repository && (
              <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                <GitBranchIcon size={12} />
                {task.repository}
              </span>
            )}
            {meta.length > 0 && (
              <Text size="1" className="truncate text-muted-foreground">
                {meta.join(" · ")}
              </Text>
            )}
            {prUrl && (
              <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
                <ArrowSquareOutIcon size={12} />
                PR
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Slack-style thread teaser under the card: reply-author facepile, count, and
// last-reply time. Only renders once the thread has messages; starting a
// thread lives in the row's hover toolbar.
function RepliesRow({
  taskId,
  onOpenThread,
}: {
  taskId: string;
  onOpenThread: () => void;
}) {
  const { messages } = useTaskThread(taskId, {
    pollIntervalMs: FEED_REPLIES_POLL_INTERVAL_MS,
  });
  const authors = useMemo(() => {
    const seen = new Map<string, (typeof messages)[number]["author"]>();
    for (const message of messages) {
      const key = message.author?.uuid ?? "unknown";
      if (!seen.has(key)) seen.set(key, message.author);
    }
    return [...seen.values()].slice(0, 4);
  }, [messages]);

  if (messages.length === 0) return null;
  const last = messages[messages.length - 1];

  return (
    <button
      type="button"
      onClick={onOpenThread}
      className="mt-1 flex w-fit items-center gap-2 rounded-md px-1.5 py-1 hover:bg-fill-secondary"
    >
      <AvatarGroup size="xs" stacked>
        {authors.map((author, index) => (
          <Avatar key={author?.uuid ?? index} size="xs">
            <AvatarFallback>{getUserInitials(author)}</AvatarFallback>
          </Avatar>
        ))}
      </AvatarGroup>
      <Text size="1" weight="medium" className="text-accent-11">
        {messages.length} {messages.length === 1 ? "reply" : "replies"}
      </Text>
      <Text size="1" className="text-muted-foreground">
        Last reply {formatRelativeTimeShort(last.created_at)}
      </Text>
    </button>
  );
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
  const isAgent = !task.created_by || task.origin_product !== "user_created";

  return (
    <ChatMessage className="group relative rounded-md px-3 py-2 hover:bg-fill-secondary/50">
      {/* Quill's avatar slot bottom-aligns for bubble chats; a Slack feed
          anchors it beside the name row. The slot draws its own circle, so
          drop its background and let the inner Avatar render. */}
      <ChatMessageAvatar className="self-start bg-transparent">
        <Avatar>
          <AvatarFallback>
            {isAgent && !task.created_by ? (
              <RobotIcon size={16} />
            ) : (
              getUserInitials(task.created_by)
            )}
          </AvatarFallback>
        </Avatar>
      </ChatMessageAvatar>
      <ChatMessageContent className="min-w-0 gap-0.5">
        <ChatMessageHeader className="items-baseline gap-2 px-0">
          <Text size="2" weight="bold" className="truncate">
            {task.created_by ? userDisplayName(task.created_by) : "Agent"}
          </Text>
          {isAgent && <Badge variant="info">Agent</Badge>}
          <Text size="1" className="shrink-0 text-muted-foreground">
            {formatRelativeTimeShort(task.created_at)}
          </Text>
        </ChatMessageHeader>

        <Text size="2" className="line-clamp-4 whitespace-pre-wrap break-words">
          {prompt}
        </Text>

        <TaskCard task={task} onOpen={() => onOpenTask(task)} />
        <RepliesRow taskId={task.id} onOpenThread={() => onOpenThread(task)} />
      </ChatMessageContent>

      {/* Hover toolbar, storybook-style: floats top-right of the row. */}
      <div className="absolute top-1 right-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <TooltipProvider delay={400}>
          <ButtonGroup className="rounded-md border border-border bg-surface shadow-sm">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="default"
                    size="icon-sm"
                    aria-label="Reply in thread"
                    onClick={() => onOpenThread(task)}
                  >
                    <ChatCircleIcon size={15} />
                  </Button>
                }
              />
              <TooltipContent side="top">Reply in thread</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="default"
                    size="icon-sm"
                    aria-label="Open task"
                    onClick={() => onOpenTask(task)}
                  >
                    <ArrowSquareOutIcon size={15} />
                  </Button>
                }
              />
              <TooltipContent side="top">Open task</TooltipContent>
            </Tooltip>
          </ButtonGroup>
        </TooltipProvider>
      </div>
    </ChatMessage>
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
          <ChatMessageScrollerContent className="mx-auto w-full max-w-[820px] px-1 py-3">
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
