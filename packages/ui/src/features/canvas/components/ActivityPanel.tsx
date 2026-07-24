import {
  ArrowSquareOutIcon,
  CaretRightIcon,
  CheckCircleIcon,
  XCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  buildThreadTimeline,
  deriveThreadAgentStatus,
  hasAgentMention,
  shouldSuspendThreadSession,
} from "@posthog/core/canvas/threadTimeline";
import {
  Button,
  cn,
  ThreadItem,
  ThreadItemAuthor,
  ThreadItemBody,
  ThreadItemContent,
  ThreadItemGroup,
  ThreadItemGutter,
  ThreadItemHeader,
} from "@posthog/quill";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import type { Task, UserBasic } from "@posthog/shared/domain-types";
import { isTerminalStatus } from "@posthog/shared/domain-types";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { UserAvatar } from "@posthog/ui/features/auth/UserAvatar";
import { useCurrentUser } from "@posthog/ui/features/auth/useCurrentUser";
import { TaskCard } from "@posthog/ui/features/canvas/components/ChannelFeedView";
import { TaskArtifactsList } from "@posthog/ui/features/canvas/components/TaskArtifactsList";
import {
  AgentStatusLine,
  ThreadArtifactRow,
  ThreadLoadingState,
  ThreadMessageRow,
  ThreadReplyComposer,
  ThreadTimeline,
} from "@posthog/ui/features/canvas/components/ThreadPanel";
import { ThreadTimestamp } from "@posthog/ui/features/canvas/components/ThreadTimestamp";
import { useOrgMembers } from "@posthog/ui/features/canvas/hooks/useOrgMembers";
import {
  useDeleteTaskThreadMessage,
  usePostTaskThreadMessage,
  usePostTaskThreadMessageToAgent,
  useSendTaskThreadMessageToAgent,
  useTaskThread,
} from "@posthog/ui/features/canvas/hooks/useTaskThread";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import { buildConversationItems } from "@posthog/ui/features/sessions/components/buildConversationItems";
import { useSessionConnection } from "@posthog/ui/features/sessions/hooks/useSessionConnection";
import { useSessionViewState } from "@posthog/ui/features/sessions/hooks/useSessionViewState";
import { usePendingPermissionsForTask } from "@posthog/ui/features/sessions/sessionStore";
import { taskDetailQuery } from "@posthog/ui/features/tasks/queries";
import { toast } from "@posthog/ui/primitives/toast";
import { track } from "@posthog/ui/shell/analytics";
import { useQuery } from "@tanstack/react-query";
import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * The spaces-layout replacement for the task ThreadPanel: an "Activity" panel
 * with three sub-views — Timeline (the task's full history on a rail),
 * Artifacts (curated outputs across all runs), Comments (the human thread).
 * The legacy ThreadPanel stays intact for the flag-off experience; the shared
 * row/composer primitives are imported from it rather than forked.
 */

type ActivityTab = "timeline" | "artifacts" | "comments";

const ACTIVITY_TABS: readonly { key: ActivityTab; label: string }[] = [
  { key: "timeline", label: "Timeline" },
  { key: "artifacts", label: "Artifacts" },
  { key: "comments", label: "Comments" },
] as const;

// Right-align every ThreadItem timestamp inside the panel (the mockup pins
// times to the right edge). Container CSS rather than forked row components,
// so the legacy ThreadPanel rows stay untouched.
const TIMESTAMP_END_CLASS =
  "[&_[data-slot=thread-item-timestamp]]:ml-auto [&_[data-slot=thread-item-timestamp]]:shrink-0 [&_[data-slot=thread-item-timestamp]]:pl-2";

// The x-offset of the avatar column's center within a ThreadItem row: row
// padding-inline (0.5rem) + gutter width (2.5rem) − half the lg avatar
// (2.35rem). The timeline rail and event nodes sit on this line so a slim
// event row lines up with the avatars above and below it.
const RAIL_LEFT = "1.825rem";

function ActivityHeader({
  onClose,
  onToggleCollapsed,
  onOpenFull,
}: {
  onClose?: () => void;
  onToggleCollapsed?: () => void;
  onOpenFull?: () => void;
}) {
  return (
    <div className="flex items-center gap-1 border-border border-b px-3 py-2">
      <div className="min-w-0 flex-1">
        <span className="block font-medium text-sm">Activity</span>
      </div>
      {onOpenFull && (
        <Button
          variant="default"
          size="icon-sm"
          aria-label="Open full task"
          onClick={onOpenFull}
        >
          <ArrowSquareOutIcon size={14} />
        </Button>
      )}
      {onToggleCollapsed && (
        <Button
          variant="default"
          size="icon-sm"
          aria-label="Collapse activity"
          onClick={onToggleCollapsed}
        >
          <CaretRightIcon size={14} />
        </Button>
      )}
      {onClose && (
        <Button
          variant="default"
          size="icon-sm"
          aria-label="Close activity"
          onClick={onClose}
        >
          <XIcon size={14} />
        </Button>
      )}
    </div>
  );
}

function ActivityTabsRow({
  tab,
  onTabChange,
}: {
  tab: ActivityTab;
  onTabChange: (tab: ActivityTab) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-px border-border border-b px-2 py-1.5">
      {ACTIVITY_TABS.map((t) => (
        <Button
          key={t.key}
          variant="default"
          size="sm"
          data-selected={tab === t.key || undefined}
          className={cn(tab === t.key && "bg-fill-selected")}
          onClick={() => onTabChange(t.key)}
        >
          {t.label}
        </Button>
      ))}
    </div>
  );
}

// A slim lifecycle event on the rail (task created / run finished): a node on
// the spine, a one-line label, and the time — lighter than a message row.
function ActivityEventRow({
  node,
  title,
  action,
  timestamp,
}: {
  node: ReactNode;
  title: string;
  action?: string;
  timestamp: string;
}) {
  return (
    <div className="flex items-center gap-2 py-1.5 pr-2 pl-2">
      <div className="flex w-10 shrink-0 justify-end">
        <div className="flex w-[2.35rem] justify-center">{node}</div>
      </div>
      <span className="min-w-0 truncate text-[13px]">
        <span className="font-medium text-gray-12">{title}</span>
        {action && <span className="text-muted-foreground"> {action}</span>}
      </span>
      <ThreadTimestamp dateTime={timestamp} />
    </div>
  );
}

// A neutral chip node for a system event with no person (run finished). Opaque
// so it masks the rail behind it, reading as a node on the spine.
function EventNode({ icon }: { icon: ReactNode }) {
  return (
    <span className="relative z-10 flex size-6 items-center justify-center rounded-full bg-gray-3">
      {icon}
    </span>
  );
}

// A user message sent to the agent, styled like the human comment rows.
function UserMessageRow({
  author,
  content,
  timestamp,
}: {
  author?: UserBasic | null;
  content: string;
  timestamp: string;
}) {
  return (
    <ThreadItem>
      <ThreadItemGutter>
        <UserAvatar user={author} size="lg" className="sticky top-2" />
      </ThreadItemGutter>
      <ThreadItemContent>
        <ThreadItemHeader>
          <ThreadItemAuthor>
            {author ? userDisplayName(author) : "You"}
          </ThreadItemAuthor>
          <ThreadTimestamp dateTime={timestamp} />
        </ThreadItemHeader>
        <ThreadItemBody>
          <span className="line-clamp-4 whitespace-pre-wrap break-words text-[13px]">
            {content}
          </span>
        </ThreadItemBody>
      </ThreadItemContent>
    </ThreadItem>
  );
}

function ActivityConversation({
  task,
  channelId,
  onClose,
  onToggleCollapsed,
  onOpenFull,
  showTaskSummary,
}: {
  task: Task;
  channelId: string;
  onClose?: () => void;
  onToggleCollapsed?: () => void;
  onOpenFull?: () => void;
  showTaskSummary: boolean;
}) {
  const taskId = task.id;
  const client = useOptionalAuthenticatedClient();
  const { data: currentUser } = useCurrentUser({ client });

  const { messages, isLoading } = useTaskThread(taskId);
  const { postMessage, isPosting } = usePostTaskThreadMessage(taskId);
  const { postMessageToAgent, isPostingToAgent } =
    usePostTaskThreadMessageToAgent(taskId);
  const { deleteMessage } = useDeleteTaskThreadMessage(taskId);
  const { sendToAgent, isSending } = useSendTaskThreadMessageToAgent(taskId);
  const isSendingToAgent = isPostingToAgent || isSending;
  const { members } = useOrgMembers();

  const {
    session,
    repoPath,
    isCloud,
    events,
    cloudStatus,
    isPromptPending,
    isInitializing,
    hasError,
    errorTitle,
  } = useSessionViewState(taskId, task);
  useSessionConnection({
    taskId,
    task,
    session,
    repoPath,
    isCloud,
    isSuspended: shouldSuspendThreadSession({
      isCloud,
      hasRun: Boolean(task.latest_run?.id),
      hasSession: Boolean(session),
    }),
  });
  const pendingPermissions = usePendingPermissionsForTask(taskId);

  const agentStatus = useMemo(
    () =>
      deriveThreadAgentStatus({
        hasActivity: events.length > 0 || !!task.latest_run,
        hasError,
        cloudStatus,
        errorTitle,
        pendingPermissionCount: pendingPermissions.size,
        isPromptPending,
        isInitializing,
      }),
    [
      events.length,
      task.latest_run,
      hasError,
      cloudStatus,
      errorTitle,
      pendingPermissions.size,
      isPromptPending,
      isInitializing,
    ],
  );

  const timeline = useMemo(() => buildThreadTimeline(messages), [messages]);

  const [tab, setTab] = useState<ActivityTab>("timeline");
  const handleTabChange = useCallback(
    (next: ActivityTab) => {
      setTab(next);
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "activity_tab_change",
        surface: "activity_panel",
        task_id: taskId,
        tab: next,
      });
    },
    [taskId],
  );
  // Comments = the human conversation without the agent's artifact
  // announcements (those live in the Artifacts tab).
  const commentRows = useMemo(
    () => timeline.filter((row) => row.kind === "human"),
    [timeline],
  );

  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleMentionInsert = useCallback(
    (member: UserBasic) => {
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "mention_member",
        surface: "activity_panel",
        task_id: taskId,
        mentioned_user_id: member.uuid,
      });
    },
    [taskId],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when rendered thread content changes
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [timeline, events.length, agentStatus?.phase, tab]);

  const isTaskAuthor =
    !!currentUser?.uuid && currentUser.uuid === task.created_by?.uuid;
  const canForward =
    !!task.latest_run &&
    !isTerminalStatus(task.latest_run.status) &&
    !isSendingToAgent;

  const submit = async () => {
    const content = draft.trim();
    if (!content || isPosting || isSendingToAgent) return;
    const sendToAgentRequested = hasAgentMention(content);
    if (sendToAgentRequested && (!isTaskAuthor || !canForward)) {
      toast.error("Couldn't send to agent", {
        description:
          "Only the task author can @agent while the task has an active run.",
      });
      return;
    }
    setDraft("");
    try {
      if (sendToAgentRequested) {
        const { sendError } = await postMessageToAgent(content);
        if (sendError) {
          toast.error("Message posted, but couldn't send it to the agent", {
            description:
              sendError instanceof Error
                ? sendError.message
                : String(sendError),
          });
        }
      } else {
        await postMessage(content);
      }
    } catch (error) {
      setDraft(content);
      toast.error("Couldn't post message", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleSendToAgent = useCallback(
    (messageId: string) => {
      sendToAgent(messageId).catch((error: unknown) => {
        toast.error("Couldn't send message to agent", {
          description: error instanceof Error ? error.message : String(error),
        });
      });
    },
    [sendToAgent],
  );

  const handleDelete = useCallback(
    (messageId: string) => {
      deleteMessage(messageId).catch((error: unknown) => {
        toast.error("Couldn't delete message", {
          description: error instanceof Error ? error.message : String(error),
        });
      });
    },
    [deleteMessage],
  );

  const isReady = !isInitializing && !isLoading;

  // The Timeline is the task's full history: creation, user messages to the
  // agent, human comments, artifact announcements, the run-output PR, and the
  // run's terminal status — merged and sorted by timestamp below.
  const conversationItems = useMemo(
    () => buildConversationItems(events, isPromptPending).items,
    [events, isPromptPending],
  );
  const activityNodes = useMemo(() => {
    const nodes: { key: string; ts: number; node: ReactNode }[] = [];
    const createdTs = Date.parse(task.created_at) || 0;
    nodes.push({
      key: "task-created",
      ts: createdTs,
      node: (
        <ActivityEventRow
          node={
            <UserAvatar
              user={task.created_by}
              size="sm"
              className="relative z-10"
            />
          }
          title={task.created_by ? userDisplayName(task.created_by) : "Someone"}
          action="created this task"
          timestamp={task.created_at}
        />
      ),
    });

    for (const item of conversationItems) {
      if (item.type !== "user_message") continue;
      nodes.push({
        key: `user-message-${item.id}`,
        ts: item.timestamp,
        node: (
          // The session carries no per-message author; the task owner drives
          // it, so attribute their avatar rather than a generic glyph.
          <UserMessageRow
            author={task.created_by}
            content={item.content}
            timestamp={new Date(item.timestamp).toISOString()}
          />
        ),
      });
    }

    let hasPrArtifact = false;
    for (const row of timeline) {
      if (row.kind === "artifact" && row.artifact.kind === "pr") {
        hasPrArtifact = true;
      }
      nodes.push({
        key: `thread-${row.message.id}`,
        ts: row.timestamp,
        node:
          row.kind === "human" ? (
            <ThreadMessageRow
              message={row.message}
              isTaskAuthor={isTaskAuthor}
              isOwnMessage={
                !!currentUser?.uuid &&
                currentUser.uuid === row.message.author?.uuid
              }
              currentUserEmail={currentUser?.email}
              canForward={canForward}
              onSendToAgent={() => handleSendToAgent(row.message.id)}
              onDelete={() => handleDelete(row.message.id)}
            />
          ) : (
            <ThreadArtifactRow
              artifact={row.artifact}
              createdAt={row.message.created_at}
            />
          ),
      });
    }

    const updatedTs = Date.parse(task.updated_at) || createdTs;
    const outputPr = task.latest_run?.output?.pr_url;
    if (typeof outputPr === "string" && outputPr && !hasPrArtifact) {
      nodes.push({
        key: "output-pr",
        ts: updatedTs,
        node: (
          <ThreadArtifactRow
            artifact={{ kind: "pr", url: outputPr }}
            createdAt={task.updated_at}
          />
        ),
      });
    }

    const runStatus = task.latest_run?.status;
    if (runStatus && isTerminalStatus(runStatus)) {
      const succeeded = runStatus === "completed";
      nodes.push({
        key: "run-status",
        ts: updatedTs + 1,
        node: (
          <ActivityEventRow
            node={
              <EventNode
                icon={
                  succeeded ? (
                    <CheckCircleIcon
                      size={14}
                      weight="fill"
                      className="text-green-9"
                    />
                  ) : (
                    <XCircleIcon
                      size={14}
                      weight="fill"
                      className="text-red-9"
                    />
                  )
                }
              />
            }
            title={`Task ${runStatus.replace(/_/g, " ")}`}
            timestamp={task.updated_at}
          />
        ),
      });
    }

    return nodes.sort((a, b) => a.ts - b.ts);
  }, [
    conversationItems,
    timeline,
    task,
    isTaskAuthor,
    canForward,
    currentUser?.uuid,
    currentUser?.email,
    handleSendToAgent,
    handleDelete,
  ]);

  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col bg-gray-1",
        TIMESTAMP_END_CLASS,
      )}
    >
      <ActivityHeader
        onOpenFull={onOpenFull}
        onToggleCollapsed={onToggleCollapsed}
        onClose={onClose}
      />
      <ActivityTabsRow tab={tab} onTabChange={handleTabChange} />

      {showTaskSummary && (
        <div className="z-10 px-2">
          <TaskCard task={task} channelId={channelId} inThread />
        </div>
      )}
      {tab === "artifacts" ? (
        <div className="flex-1 overflow-y-auto">
          <TaskArtifactsList task={task} timeline={timeline} />
        </div>
      ) : tab === "comments" ? (
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <ThreadTimeline
            timeline={commentRows}
            isReady={isReady}
            currentUserUuid={currentUser?.uuid}
            currentUserEmail={currentUser?.email}
            isTaskAuthor={isTaskAuthor}
            canForward={canForward}
            onSendToAgent={handleSendToAgent}
            onDelete={handleDelete}
          />
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {!isReady ? (
            <ThreadLoadingState />
          ) : (
            <div className="relative">
              {/* The timeline spine: a continuous rail down the avatar column
                  that every row's avatar/node sits on, so slim event rows and
                  chunky message rows read as one timeline. */}
              <div
                aria-hidden
                className="pointer-events-none absolute top-4 bottom-4 w-px bg-border"
                style={{ left: RAIL_LEFT }}
              />
              <div className="relative z-10">
                <ThreadItemGroup>
                  {activityNodes.map((entry) => (
                    <Fragment key={entry.key}>{entry.node}</Fragment>
                  ))}
                </ThreadItemGroup>
              </div>
            </div>
          )}
        </div>
      )}

      {tab !== "artifacts" && agentStatus && (
        <AgentStatusLine status={agentStatus} />
      )}

      {tab !== "artifacts" && (
        <ThreadReplyComposer
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={submit}
          members={members}
          allowAgentMention={isTaskAuthor && canForward}
          onMentionInsert={handleMentionInsert}
          disabled={!draft.trim() || isPosting || isSendingToAgent}
        />
      )}
    </div>
  );
}

export function ActivityPanel({
  taskId,
  channelId,
  task: taskProp,
  onClose,
  collapsed,
  onToggleCollapsed,
  onOpenFull,
  showTaskSummary = true,
}: {
  taskId: string;
  channelId: string;
  task?: Task;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onOpenFull?: () => void;
  showTaskSummary?: boolean;
}) {
  const { data: fetchedTask } = useQuery({
    ...taskDetailQuery(taskId),
    enabled: !taskProp && !collapsed,
  });
  const task = taskProp ?? fetchedTask;

  if (collapsed) {
    return (
      <div className="flex h-full w-9 flex-col items-center border-border border-l bg-gray-1 py-2">
        <Button
          variant="default"
          size="icon-sm"
          aria-label="Expand activity"
          onClick={onToggleCollapsed}
        >
          <CaretRightIcon size={14} className="rotate-180" />
        </Button>
      </div>
    );
  }

  if (!task) {
    return <ThreadLoadingState />;
  }

  return (
    <ActivityConversation
      task={task}
      channelId={channelId}
      onClose={onClose}
      onToggleCollapsed={onToggleCollapsed}
      onOpenFull={onOpenFull}
      showTaskSummary={showTaskSummary}
    />
  );
}
