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
  cn,
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
import {
  type SidebarPrState,
  useTaskPrStatus,
} from "@posthog/ui/features/sidebar/useTaskPrStatus";
import { Text } from "@radix-ui/themes";
import { type ReactNode, useMemo } from "react";

// Feed rows poll their reply counts slower than the open thread panel — the
// shared query key means an open panel naturally speeds the row up too.
const FEED_REPLIES_POLL_INTERVAL_MS = 15_000;

const STATUS_LABELS: Record<TaskRunStatus, string> = {
  not_started: "Not started",
  queued: "Queued",
  in_progress: "In progress",
  // "Ready", not "Completed": the agent has finished its work and the task is
  // ready to look at, but the change itself isn't necessarily shipped/done.
  completed: "Ready",
  failed: "Failed",
  cancelled: "Cancelled",
};

// Once a PR exists its GitHub state is the truest top-line status — more
// accurate than the run status, which routinely lingers on "in_progress"
// (or a stale cloud status) after the agent opens the PR. Mirrors the PR
// states the sidebar's TaskIcon already renders.
const PR_STATE_LABELS: Record<
  Exclude<SidebarPrState, null>,
  { label: string; variant: "success" | "info" | "default" | "destructive" }
> = {
  merged: { label: "Merged", variant: "success" },
  open: { label: "PR ready", variant: "info" },
  draft: { label: "Draft PR", variant: "default" },
  closed: { label: "Closed", variant: "destructive" },
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

interface TaskStatusDisplay {
  // The run/environment badge ("Local", "Completed", "In progress", …).
  base: ReactNode;
  // The PR's GitHub state, shown alongside the run badge when a PR exists.
  prState: Exclude<SidebarPrState, null> | null;
  // Whether the PR has merged — the card lifts this to a purple border + tint.
  isMerged: boolean;
}

// Live status for the card, derived the same way the sidebar's TaskIcon does
// (via useChannelTaskData: local session + workspace + cloud run). The raw
// `latest_run.status` alone is wrong for local runs — the backend row often
// stays "queued" while the agent runs on the creator's machine — so it is
// only trusted for cloud runs and terminal states (which imply a sync).
//
// Once a PR exists its state ("PR ready", "Merged", …) is the sole top-line
// status — it replaces the run badge rather than sitting next to it, so a
// shipped task never reads "Ready + Merged" or a stale "In progress + PR
// ready". A failed/cancelled run suppresses the PR badge instead — that is a
// deliberate end state we should not soften with a PR.
function useTaskStatusDisplay(task: Task): TaskStatusDisplay {
  const data = useChannelTaskData(task);
  const { prState } = useTaskPrStatus({
    id: task.id,
    cloudPrUrl: data?.cloudPrUrl ?? null,
    taskRunEnvironment: data?.taskRunEnvironment ?? null,
  });
  const status = data?.taskRunStatus ?? task.latest_run?.status;
  const environment = data?.taskRunEnvironment ?? task.latest_run?.environment;
  // `prState` is resolved async from git/`gh` and is routinely null for cloud
  // tasks (the details fetch hasn't landed, or there's no cached row). But the
  // PR URL itself is a hard signal a PR exists — the card's "PR" link keys off
  // exactly this. Fall back to it so the badge and the link never disagree; a
  // known URL with no resolved state is shown as the neutral "open" ("PR
  // ready"), never something stronger like "merged".
  const hasPrUrl =
    typeof (data?.cloudPrUrl ?? task.latest_run?.output?.pr_url) === "string";
  const effectivePrState: Exclude<SidebarPrState, null> | null =
    prState ?? (hasPrUrl ? "open" : null);
  const showPrState =
    !!effectivePrState && status !== "failed" && status !== "cancelled";

  let base: ReactNode;
  if (data?.needsPermission) {
    // Live, actionable states still win over the PR badge — the agent is
    // waiting on the user right now, which matters more than a PR existing.
    base = <Badge variant="warning">Needs input</Badge>;
  } else if (data?.isGenerating) {
    base = (
      <Badge variant="info">
        <Spinner className="size-2.5" />
        In progress
      </Badge>
    );
  } else if (showPrState) {
    // Otherwise the PR badge is the whole story once a PR exists; skip the run
    // badge so we never show "Ready + Merged" or a stale "In progress".
    base = null;
  } else if (!status) {
    base = <Badge>Draft</Badge>;
  } else if (environment === "cloud" || isTerminalStatus(status)) {
    base = statusBadge(status);
  } else {
    // Local, non-terminal: the run status is unreliable (the backend row stays
    // "queued" while the agent runs on the creator's machine), and the
    // environment already shows in the card's meta row ("· Local"), so we
    // render no status badge here rather than a redundant "Local" pill.
    base = null;
  }

  return {
    base,
    prState: showPrState ? effectivePrState : null,
    isMerged: showPrState && effectivePrState === "merged",
  };
}

// The merged badge borrows the purple GitHub-merge accent (matching the
// sidebar's TaskIcon merge glyph). Quill has no purple variant, so we tint a
// neutral badge with the Radix purple scale — allowed inline because the
// values are CSS variables, not hardcoded colors.
function PrStateBadge({ prState }: { prState: Exclude<SidebarPrState, null> }) {
  const { label, variant } = PR_STATE_LABELS[prState];
  if (prState === "merged") {
    return (
      <Badge
        variant="default"
        style={{
          backgroundColor: "var(--purple-a3)",
          color: "var(--purple-11)",
        }}
      >
        {label}
      </Badge>
    );
  }
  return <Badge variant={variant}>{label}</Badge>;
}

function TaskStatusBadge({ display }: { display: TaskStatusDisplay }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {display.base}
      {display.prState && <PrStateBadge prState={display.prState} />}
    </div>
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
  const statusDisplay = useTaskStatusDisplay(task);
  const prUrl =
    typeof task.latest_run?.output?.pr_url === "string"
      ? task.latest_run.output.pr_url
      : undefined;
  // The repository renders separately with its icon; `meta` is the plain-text
  // remainder of the row.
  const environment = task.latest_run?.environment;
  const meta = [
    task.slug || null,
    task.latest_run?.stage ?? null,
    environment === "cloud"
      ? "Cloud"
      : environment === "local"
        ? "Local"
        : null,
  ].filter(Boolean) as string[];

  return (
    <Card
      size="sm"
      className={cn(
        "mt-1.5 w-full cursor-pointer py-0 transition-colors hover:bg-fill-hover",
        statusDisplay.isMerged
          ? "border-transparent bg-(--purple-a1) shadow-[0_0_0_1px_var(--purple-8)]"
          : "hover:border-border-primary",
      )}
      onClick={onOpen}
    >
      <CardContent className="flex flex-col gap-1 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <TaskCardOrigin task={task} />
          <TaskStatusBadge display={statusDisplay} />
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
