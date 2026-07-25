import {
  ArrowSquareOutIcon,
  CaretRightIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  buildThreadTimeline,
  deriveThreadAgentStatus,
  hasAgentMention,
  shouldSuspendThreadSession,
} from "@posthog/core/canvas/threadTimeline";
import { Button, cn } from "@posthog/quill";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import type { Task, UserBasic } from "@posthog/shared/domain-types";
import { isTerminalStatus } from "@posthog/shared/domain-types";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useCurrentUser } from "@posthog/ui/features/auth/useCurrentUser";
import { ActivityTimeline } from "@posthog/ui/features/canvas/components/ActivityTimeline";
import { TaskCard } from "@posthog/ui/features/canvas/components/ChannelFeedView";
import { TaskArtifactsList } from "@posthog/ui/features/canvas/components/TaskArtifactsList";
import {
  AgentStatusLine,
  ThreadLoadingState,
  ThreadReplyComposer,
  ThreadTimeline,
} from "@posthog/ui/features/canvas/components/ThreadPanel";
import { useOrgMembers } from "@posthog/ui/features/canvas/hooks/useOrgMembers";
import {
  useDeleteTaskThreadMessage,
  usePostTaskThreadMessage,
  usePostTaskThreadMessageToAgent,
  useSendTaskThreadMessageToAgent,
  useTaskThread,
} from "@posthog/ui/features/canvas/hooks/useTaskThread";
import { buildConversationItems } from "@posthog/ui/features/sessions/components/buildConversationItems";
import { useSessionConnection } from "@posthog/ui/features/sessions/hooks/useSessionConnection";
import { useSessionViewState } from "@posthog/ui/features/sessions/hooks/useSessionViewState";
import { usePendingPermissionsForTask } from "@posthog/ui/features/sessions/sessionStore";
import { taskDetailQuery } from "@posthog/ui/features/tasks/queries";
import { toast } from "@posthog/ui/primitives/toast";
import { track } from "@posthog/ui/shell/analytics";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * The flag-gated task panel — Timeline / Artifacts / Comments. Legacy
 * ThreadPanel stays for flag-off; its row/composer primitives are reused here.
 */

type ActivityTab = "timeline" | "artifacts" | "comments";

const ACTIVITY_TABS: readonly { key: ActivityTab; label: string }[] = [
  { key: "timeline", label: "Timeline" },
  { key: "artifacts", label: "Artifacts" },
  { key: "comments", label: "Comments" },
] as const;

// Right-align row timestamps via container CSS, leaving the shared rows untouched.
const TIMESTAMP_END_CLASS =
  "[&_[data-slot=thread-item-timestamp]]:ml-auto [&_[data-slot=thread-item-timestamp]]:shrink-0 [&_[data-slot=thread-item-timestamp]]:pl-2";

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
  // Comments = the human thread without artifact announcements (those are the
  // Artifacts tab).
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

  const conversationItems = useMemo(
    () => buildConversationItems(events, isPromptPending).items,
    [events, isPromptPending],
  );

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
            <ActivityTimeline
              task={task}
              timeline={timeline}
              conversationItems={conversationItems}
              currentUserUuid={currentUser?.uuid}
              currentUserEmail={currentUser?.email}
              isTaskAuthor={isTaskAuthor}
              canForward={canForward}
              onSendToAgent={handleSendToAgent}
              onDelete={handleDelete}
            />
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
