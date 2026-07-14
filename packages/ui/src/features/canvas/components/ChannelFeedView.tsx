import {
  ArrowSquareOutIcon,
  ChatCircleIcon,
  GitBranchIcon,
  RobotIcon,
} from "@phosphor-icons/react";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  Badge,
  Card,
  CardContent,
  ChatMarker,
  ChatMarkerContent,
  ChatMessageScroller,
  ChatMessageScrollerButton,
  ChatMessageScrollerContent,
  ChatMessageScrollerItem,
  ChatMessageScrollerProvider,
  ChatMessageScrollerViewport,
  cn,
  Spinner,
  ThreadItem,
  ThreadItemAction,
  ThreadItemActions,
  ThreadItemAuthor,
  ThreadItemBody,
  ThreadItemContent,
  ThreadItemGutter,
  ThreadItemHeader,
  ThreadItemReplies,
  ThreadItemRepliesLabel,
  ThreadItemRepliesMeta,
  ThreadItemTimestamp,
} from "@posthog/quill";
import { formatRelativeTimeShort } from "@posthog/shared";
import type { Task, TaskRunStatus } from "@posthog/shared/domain-types";
import { isTerminalStatus } from "@posthog/shared/domain-types";
import { getUserInitials } from "@posthog/ui/features/auth/userInitials";
import { TaskTabIcon } from "@posthog/ui/features/browser-tabs/TaskTabIcon";
import { mentionChipClass } from "@posthog/ui/features/canvas/components/MentionText";
import { useChannelTaskData } from "@posthog/ui/features/canvas/hooks/useChannelTaskData";
import { useTaskThread } from "@posthog/ui/features/canvas/hooks/useTaskThread";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import {
  type SidebarPrState,
  useTaskPrStatus,
} from "@posthog/ui/features/sidebar/useTaskPrStatus";
import { useInView } from "@posthog/ui/primitives/hooks/useInView";
import { Text } from "@radix-ui/themes";
import { Fragment, memo, type ReactNode, useMemo } from "react";

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
  merged: { label: "Merged", variant: "default" },
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

// Local calendar-day identity, so tasks created on the same day share a heading
// regardless of time. Uses local getters (not the UTC ISO) so the split lands
// on the viewer's midnight.
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function ordinal(n: number): string {
  const suffix = ["th", "st", "nd", "rd"];
  const rem = n % 100;
  return `${n}${suffix[(rem - 20) % 10] ?? suffix[rem] ?? suffix[0]}`;
}

// The day-separator label: "Today" / "Yesterday" for the recent days, then a
// weekday + ordinal ("Monday 5th") within the week, adding the month (and the
// year when it differs) further back so older separators stay unambiguous.
function dayLabel(iso: string, now: Date): string {
  const date = new Date(iso);
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  const weekday = date.toLocaleDateString(undefined, { weekday: "long" });
  const day = ordinal(date.getDate());
  if (days < 7) return `${weekday} ${day}`;
  const month = date.toLocaleDateString(undefined, { month: "long" });
  const year =
    date.getFullYear() === now.getFullYear() ? "" : `, ${date.getFullYear()}`;
  return `${weekday}, ${month} ${day}${year}`;
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
    // "queued" while the agent runs on the creator's machine), so we render no
    // status badge rather than a misleading one.
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

// The task the message kicked off, as a card everyone in the channel sees:
// bold title + status up top, then run metadata.
function TaskCard({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const statusDisplay = useTaskStatusDisplay(task);
  const prUrl =
    typeof task.latest_run?.output?.pr_url === "string"
      ? task.latest_run.output.pr_url
      : undefined;
  const stage = task.latest_run?.stage;

  return (
    <Card
      size="sm"
      className={cn(
        "mt-1.5 w-full cursor-pointer rounded-sm py-0 transition-none hover:bg-fill-hover",
        statusDisplay.isMerged
          ? "border-transparent bg-(--purple-a2) shadow-[0_0_0_1px_var(--purple-8)] hover:bg-(--purple-a3) dark:bg-(--purple-a1) dark:hover:bg-(--purple-a2)"
          : "hover:border-border-primary",
      )}
      onClick={onOpen}
    >
      <CardContent className="flex flex-col gap-1 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {/* Same live status icon as the code side nav, so the card and the
                nav never disagree (generating spinner, needs-permission, cloud
                status colors, PR state). */}
            <TaskTabIcon task={task} size={14} />
            <Text size="2" weight="medium" className="line-clamp-2">
              {task.title || "Untitled task"}
            </Text>
          </div>
          <TaskStatusBadge display={statusDisplay} />
        </div>
        {(stage || task.repository || prUrl) && (
          <div className="flex min-w-0 items-center gap-3">
            {task.repository && (
              <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                <GitBranchIcon size={12} />
                {task.repository}
              </span>
            )}
            {stage && (
              <Text size="1" className="truncate text-muted-foreground">
                {stage}
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

// The reply row under the card, always present at a constant height: the
// Slack-style teaser (author facepile, count, last-reply time) once the thread
// has messages, and a quiet "Reply" affordance otherwise. Keeping the row
// mounted at a fixed height means the teaser swaps in after the thread fetch
// lands without shifting the feed — and it surfaces an always-visible way into
// the thread instead of hiding it in the hover toolbar.
//
// The fetch/poll only runs for near-viewport rows (`inView`); off-screen rows
// render the static affordance and idle, so a long feed isn't polling per row.
function ReplyFooter({
  taskId,
  inView,
  onOpenThread,
}: {
  taskId: string;
  inView: boolean;
  onOpenThread: () => void;
}) {
  const { messages } = useTaskThread(taskId, {
    pollIntervalMs: FEED_REPLIES_POLL_INTERVAL_MS,
    enabled: inView,
  });
  const authors = useMemo(() => {
    const seen = new Map<string, (typeof messages)[number]["author"]>();
    for (const message of messages) {
      const key = message.author?.uuid ?? "unknown";
      if (!seen.has(key)) seen.set(key, message.author);
    }
    return [...seen.values()].slice(0, 4);
  }, [messages]);

  if (messages.length === 0) {
    // A single avatar-sized slot keeps this row the exact height of the
    // populated teaser, so swapping to it after the fetch never shifts the feed.
    return (
      <ThreadItemReplies onClick={onOpenThread} className="mt-1">
        <AvatarGroup size="xs">
          <Avatar size="xs">
            <AvatarFallback>
              <ChatCircleIcon size={12} />
            </AvatarFallback>
          </Avatar>
        </AvatarGroup>
        <ThreadItemRepliesLabel className="text-(--muted-foreground)">
          Reply
        </ThreadItemRepliesLabel>
      </ThreadItemReplies>
    );
  }

  const last = messages[messages.length - 1];
  return (
    <ThreadItemReplies onClick={onOpenThread} className="mt-1">
      <AvatarGroup size="xs">
        {authors.map((author, index) => (
          <Avatar key={author?.uuid ?? index} size="xs">
            <AvatarFallback>{getUserInitials(author)}</AvatarFallback>
          </Avatar>
        ))}
      </AvatarGroup>
      <ThreadItemRepliesLabel>
        {messages.length} {messages.length === 1 ? "reply" : "replies"}
      </ThreadItemRepliesLabel>
      <ThreadItemRepliesMeta>
        Last reply {formatRelativeTimeShort(last.created_at)}
      </ThreadItemRepliesMeta>
    </ThreadItemReplies>
  );
}

const FeedItem = memo(function FeedItem({
  task,
  inView,
  onOpenTask,
  onOpenThread,
}: {
  task: Task;
  inView: boolean;
  onOpenTask: (task: Task) => void;
  onOpenThread: (task: Task) => void;
}) {
  return (
    <ThreadItem className="rounded-none py-4 pr-8 hover:bg-fill-hover/50">
      <ThreadItemGutter>
        <Avatar>
          <AvatarFallback>
            <RobotIcon size={16} />
          </AvatarFallback>
        </Avatar>
      </ThreadItemGutter>

      <ThreadItemContent className="min-w-0">
        <ThreadItemHeader>
          <ThreadItemAuthor>PostHog</ThreadItemAuthor>
          <Badge variant="info">Agent</Badge>
          <ThreadItemTimestamp
            dateTime={new Date(task.created_at).toISOString()}
          >
            {formatRelativeTimeShort(task.created_at)}
          </ThreadItemTimestamp>
        </ThreadItemHeader>

        <ThreadItemBody className="wrap-break-word">
          {/* Only attribute channel-started tasks: other origins (Slack,
              automations) carry a created_by who didn't start it here. */}
          {task.origin_product === "user_created" && task.created_by ? (
            <>
              {/* Mention-styled but rendered inert: the starter shouldn't be
                  notified about their own task. */}
              <span className={mentionChipClass}>
                @{userDisplayName(task.created_by)}
              </span>{" "}
              started a new task
            </>
          ) : (
            "A new task was started"
          )}
        </ThreadItemBody>

        <TaskCard task={task} onOpen={() => onOpenTask(task)} />
        <ReplyFooter
          taskId={task.id}
          inView={inView}
          onOpenThread={() => onOpenThread(task)}
        />
      </ThreadItemContent>

      {/* Replying now lives in the always-visible ReplyFooter, so the hover
          toolbar only carries the distinct "Open task" action. Actions anchor
          to the row's top-right corner; a top tooltip there overhangs the panel
          edge and gets clipped by the scroll container, so open tooltips toward
          the content instead. */}
      <ThreadItemActions aria-label="Message actions" className="inset-bs-2">
        <ThreadItemAction label="Open task" onClick={() => onOpenTask(task)}>
          <ArrowSquareOutIcon size={15} />
        </ThreadItemAction>
      </ThreadItemActions>
    </ThreadItem>
  );
});

// One feed row: owns the scroller item (the `content-visibility` boundary, so
// its box is always laid out and safe to observe) and reports whether it is
// near the viewport, letting `FeedItem` shed off-screen polling.
function FeedRow({
  task,
  onOpenTask,
  onOpenThread,
}: {
  task: Task;
  onOpenTask: (task: Task) => void;
  onOpenThread: (task: Task) => void;
}) {
  const [ref, inView] = useInView<HTMLDivElement>({ rootMargin: "1200px 0px" });
  return (
    <ChatMessageScrollerItem
      ref={ref}
      messageId={task.id}
      // Rows already get `content-visibility:auto` from quill, but its default
      // `contain-intrinsic-size` (10rem) under-reserves a feed row (message +
      // task card + replies ≈ 13rem), so off-screen rows collapse too small and
      // the scrollbar jumps as they paint in. A closer estimate keeps scrolling
      // stable; `auto` still remembers each row's real height after first paint.
      className="[contain-intrinsic-size:auto_13rem]"
    >
      <FeedItem
        task={task}
        inView={inView}
        onOpenTask={onOpenTask}
        onOpenThread={onOpenThread}
      />
    </ChatMessageScrollerItem>
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

  const now = new Date();

  return (
    <ChatMessageScrollerProvider defaultScrollPosition="end">
      <ChatMessageScroller className="min-h-0 flex-1">
        <ChatMessageScrollerViewport>
          {/* Horizontal padding is load-bearing: ThreadItem's actions float at
              the row's top-right corner (absolute, past the row edge). Without a
              gutter they hug the scroll container and get clipped. */}
          <ChatMessageScrollerContent className="mx-auto w-full gap-0 py-4">
            {tasks.map((task, index) => {
              const previous = tasks[index - 1];
              const showDayMarker =
                !previous ||
                dayKey(previous.created_at) !== dayKey(task.created_at);
              return (
                <Fragment key={task.id}>
                  {showDayMarker && (
                    <ChatMarker variant="separator">
                      <ChatMarkerContent>
                        {dayLabel(task.created_at, now)}
                      </ChatMarkerContent>
                    </ChatMarker>
                  )}
                  <FeedRow
                    task={task}
                    onOpenTask={onOpenTask}
                    onOpenThread={onOpenThread}
                  />
                </Fragment>
              );
            })}
          </ChatMessageScrollerContent>
        </ChatMessageScrollerViewport>
        <ChatMessageScrollerButton />
      </ChatMessageScroller>
    </ChatMessageScrollerProvider>
  );
}
