import {
  ArrowDownIcon,
  ArrowSquareOutIcon,
  CaretRightIcon,
  DotsThreeIcon,
  PaperPlaneRightIcon,
  RobotIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  buildThreadTimeline,
  deriveThreadAgentStatus,
  hasAgentMention,
  normalizeAgentPromptText,
  shouldSuspendThreadSession,
  type ThreadAgentMessage,
  type ThreadAgentStatus,
  type ThreadTimelineRow,
} from "@posthog/core/canvas/threadTimeline";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  InputGroupAddon,
  InputGroupButton,
  Spinner,
  ThreadItem,
  ThreadItemAction,
  ThreadItemActions,
  ThreadItemAuthor,
  ThreadItemBody,
  ThreadItemContent,
  ThreadItemGroup,
  ThreadItemGutter,
  ThreadItemHeader,
} from "@posthog/quill";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import type {
  Task,
  TaskThreadMessage,
  UserBasic,
} from "@posthog/shared/domain-types";
import { isTerminalStatus } from "@posthog/shared/domain-types";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useCurrentUser } from "@posthog/ui/features/auth/useCurrentUser";
import { getUserInitials } from "@posthog/ui/features/auth/userInitials";
import { TaskCard } from "@posthog/ui/features/canvas/components/ChannelFeedView";
import { MentionComposer } from "@posthog/ui/features/canvas/components/MentionComposer";
import {
  MentionText,
  mentionChipClass,
} from "@posthog/ui/features/canvas/components/MentionText";
import { ThreadTimestamp } from "@posthog/ui/features/canvas/components/ThreadTimestamp";
import { agentTurns } from "@posthog/ui/features/canvas/components/threadAgentTurns";
import { useOrgMembers } from "@posthog/ui/features/canvas/hooks/useOrgMembers";
import {
  useDeleteTaskThreadMessage,
  usePostTaskThreadMessage,
  usePostTaskThreadMessageToAgent,
  useSendTaskThreadMessageToAgent,
  useTaskThread,
} from "@posthog/ui/features/canvas/hooks/useTaskThread";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import type { ConversationItem } from "@posthog/ui/features/sessions/components/buildConversationItems";
import {
  ChatMarkdown,
  ChatStreamingMarkdown,
} from "@posthog/ui/features/sessions/components/chat-thread/ChatMarkdown";
import { extractChannelContext } from "@posthog/ui/features/sessions/components/session-update/channelContext";
import { useConversationItems } from "@posthog/ui/features/sessions/hooks/useConversationItems";
import { useSessionConnection } from "@posthog/ui/features/sessions/hooks/useSessionConnection";
import { useSessionViewState } from "@posthog/ui/features/sessions/hooks/useSessionViewState";
import { usePendingPermissionsForTask } from "@posthog/ui/features/sessions/sessionStore";
import { taskDetailQuery } from "@posthog/ui/features/tasks/queries";
import { toast } from "@posthog/ui/primitives/toast";
import { track } from "@posthog/ui/shell/analytics";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function ThreadMessageRow({
  message,
  isTaskAuthor,
  isOwnMessage,
  currentUserEmail,
  canForward,
  highlighted,
  onSendToAgent,
  onDelete,
}: {
  message: TaskThreadMessage;
  isTaskAuthor: boolean;
  isOwnMessage: boolean;
  currentUserEmail?: string | null;
  canForward: boolean;
  highlighted?: boolean;
  onSendToAgent: () => void;
  onDelete: () => void;
}) {
  const forwarded = !!message.forwarded_to_agent_at;
  const authorKind = message.author_kind ?? "human";
  const isAgent = authorKind === "agent";
  const isSystem = authorKind === "system";
  const showMenu =
    authorKind === "human" && ((isTaskAuthor && !forwarded) || isOwnMessage);

  return (
    <ThreadItem
      data-thread-message-id={message.id}
      className={highlighted ? "thread-mention-highlight" : undefined}
    >
      <ThreadItemGutter>
        <Avatar size="lg" className="sticky top-2">
          <AvatarFallback>
            {isAgent ? (
              <RobotIcon size={14} />
            ) : isSystem ? (
              "S"
            ) : (
              getUserInitials(message.author)
            )}
          </AvatarFallback>
        </Avatar>
      </ThreadItemGutter>
      <ThreadItemContent>
        <ThreadItemHeader>
          <ThreadItemAuthor>
            {isAgent
              ? "Agent"
              : isSystem
                ? "System"
                : userDisplayName(message.author)}
          </ThreadItemAuthor>
          <ThreadTimestamp dateTime={message.created_at} />
        </ThreadItemHeader>
        <ThreadItemBody>
          <MentionText
            content={message.content}
            currentUserEmail={currentUserEmail}
          />
        </ThreadItemBody>
        {forwarded && (
          <Badge variant="info" className="w-fit">
            <RobotIcon size={10} />
            Sent to agent
          </Badge>
        )}
      </ThreadItemContent>
      {showMenu && (
        <ThreadItemActions>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <ThreadItemAction label="Message actions">
                  <DotsThreeIcon size={14} />
                </ThreadItemAction>
              }
            />
            <DropdownMenuContent align="end">
              {isTaskAuthor && !forwarded && (
                <DropdownMenuItem
                  disabled={!canForward}
                  onClick={onSendToAgent}
                >
                  <PaperPlaneRightIcon size={14} />
                  Send to agent
                </DropdownMenuItem>
              )}
              {isOwnMessage && (
                <DropdownMenuItem variant="destructive" onClick={onDelete}>
                  <TrashIcon size={14} />
                  Delete message
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </ThreadItemActions>
      )}
    </ThreadItem>
  );
}

function agentPrompts(items: ConversationItem[]): ThreadAgentMessage[] {
  const prompts: ThreadAgentMessage[] = [];
  for (const item of items) {
    if (item.type !== "user_message") continue;
    const text = (
      extractChannelContext(item.content)?.stripped ?? item.content
    ).trim();
    if (!text) continue;
    prompts.push({ id: item.id, text, timestamp: item.timestamp });
  }
  return prompts;
}

export function AgentStatusLine({ status }: { status: ThreadAgentStatus }) {
  return (
    <output
      aria-live="polite"
      className="flex items-center gap-1.5 px-3 py-1.5 text-muted-foreground text-xs"
    >
      {status.phase === "active" ? (
        <Spinner className="size-3" />
      ) : (
        <RobotIcon size={12} />
      )}
      <span>{status.label}</span>
    </output>
  );
}

export function AgentTurnRow({
  message,
  streaming,
  highlighted,
}: {
  message: ThreadAgentMessage;
  streaming: boolean;
  highlighted?: boolean;
}) {
  return (
    <ThreadItem
      data-thread-message-id={message.id}
      className={highlighted ? "thread-mention-highlight" : undefined}
    >
      <ThreadItemGutter>
        <Avatar size="lg" className="sticky top-2">
          <AvatarFallback>
            <RobotIcon size={14} />
          </AvatarFallback>
        </Avatar>
      </ThreadItemGutter>
      <ThreadItemContent>
        <ThreadItemHeader>
          <ThreadItemAuthor>Agent</ThreadItemAuthor>
          {message.timestamp !== undefined && (
            <ThreadTimestamp
              dateTime={new Date(message.timestamp).toISOString()}
            />
          )}
        </ThreadItemHeader>
        {message.text && (
          <ThreadItemBody>
            <div className="rounded-md border border-border bg-muted px-2 py-1.5">
              {streaming ? (
                <ChatStreamingMarkdown content={message.text} />
              ) : (
                <ChatMarkdown content={message.text} />
              )}
            </div>
          </ThreadItemBody>
        )}
      </ThreadItemContent>
    </ThreadItem>
  );
}

export function UserPromptRow({
  message,
  author,
  highlighted,
}: {
  message: ThreadAgentMessage;
  author: TaskThreadMessage["author"];
  highlighted?: boolean;
}) {
  const promptText = normalizeAgentPromptText(message.text);

  return (
    <ThreadItem
      data-thread-message-id={message.id}
      className={highlighted ? "thread-mention-highlight" : undefined}
    >
      <ThreadItemGutter>
        <Avatar size="lg" className="sticky top-2">
          <AvatarFallback>{getUserInitials(author)}</AvatarFallback>
        </Avatar>
      </ThreadItemGutter>
      <ThreadItemContent>
        <ThreadItemHeader>
          <ThreadItemAuthor>{userDisplayName(author)}</ThreadItemAuthor>
          {message.timestamp !== undefined && (
            <ThreadTimestamp
              dateTime={new Date(message.timestamp).toISOString()}
            />
          )}
        </ThreadItemHeader>
        <ThreadItemBody className="wrap-break-word whitespace-pre-wrap">
          <span className={mentionChipClass}>@agent</span> {promptText}
        </ThreadItemBody>
      </ThreadItemContent>
    </ThreadItem>
  );
}

function ThreadLoadingState() {
  return (
    <Empty className="h-full border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Spinner />
        </EmptyMedia>
        <EmptyTitle>Loading thread</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}

function ThreadHeader({
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
        <span className="block font-medium text-sm">Thread</span>
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
          aria-label="Collapse thread"
          onClick={onToggleCollapsed}
        >
          <CaretRightIcon size={14} />
        </Button>
      )}
      {onClose && (
        <Button
          variant="default"
          size="icon-sm"
          aria-label="Close thread"
          onClick={onClose}
        >
          <XIcon size={14} />
        </Button>
      )}
    </div>
  );
}

function ThreadTimeline({
  timeline,
  isReady,
  taskAuthor,
  currentUserUuid,
  currentUserEmail,
  isTaskAuthor,
  canForward,
  lastAgentId,
  agentActive,
  highlightId,
  onSendToAgent,
  onDelete,
}: {
  timeline: ThreadTimelineRow<TaskThreadMessage>[];
  isReady: boolean;
  taskAuthor: UserBasic | null | undefined;
  currentUserUuid?: string;
  currentUserEmail?: string;
  isTaskAuthor: boolean;
  canForward: boolean;
  lastAgentId?: string;
  agentActive: boolean;
  highlightId?: string;
  onSendToAgent: (messageId: string) => void;
  onDelete: (messageId: string) => void;
}) {
  if (!isReady) return <ThreadLoadingState />;
  if (timeline.length === 0) {
    return (
      <Empty className="h-full border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <RobotIcon size={18} />
          </EmptyMedia>
          <EmptyTitle>No messages yet</EmptyTitle>
          <EmptyDescription>
            Discuss this task with your team. The agent's status shows up here
            too; messages stay between humans unless the task author sends one
            to the agent.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ThreadItemGroup>
      {timeline.map((row) =>
        row.kind === "prompt" ? (
          <UserPromptRow
            key={row.message.id}
            message={row.message}
            author={taskAuthor}
            highlighted={row.message.id === highlightId}
          />
        ) : row.kind === "human" ? (
          <ThreadMessageRow
            key={row.message.id}
            message={row.message.value as TaskThreadMessage}
            isTaskAuthor={isTaskAuthor}
            isOwnMessage={
              !!currentUserUuid &&
              currentUserUuid === row.message.value?.author?.uuid
            }
            currentUserEmail={currentUserEmail}
            canForward={canForward}
            highlighted={row.message.id === highlightId}
            onSendToAgent={() => onSendToAgent(row.message.id)}
            onDelete={() => onDelete(row.message.id)}
          />
        ) : (
          <AgentTurnRow
            key={row.message.id}
            message={row.message}
            streaming={row.message.id === lastAgentId && agentActive}
            highlighted={row.message.id === highlightId}
          />
        ),
      )}
    </ThreadItemGroup>
  );
}

function ThreadReplyComposer({
  draft,
  onDraftChange,
  onSubmit,
  members,
  allowAgentMention,
  onMentionInsert,
  disabled,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  members: UserBasic[];
  allowAgentMention: boolean;
  onMentionInsert: (member: UserBasic) => void;
  disabled: boolean;
}) {
  return (
    <div className="border-border border-t p-2">
      <MentionComposer
        value={draft}
        onValueChange={onDraftChange}
        onSubmit={onSubmit}
        members={members}
        allowAgentMention={allowAgentMention}
        onMentionInsert={onMentionInsert}
        placeholder="Reply in thread… @agent sends to the agent"
        rows={2}
        inputClassName="max-h-40 text-[13px]"
      >
        <InputGroupAddon align="block-end" className="p-1">
          <span className="ml-auto flex items-center gap-1">
            <InputGroupButton
              variant="primary"
              size="icon-sm"
              aria-label="Send"
              disabled={disabled}
              onClick={onSubmit}
            >
              <PaperPlaneRightIcon size={14} />
            </InputGroupButton>
          </span>
        </InputGroupAddon>
      </MentionComposer>
    </div>
  );
}

function ThreadConversation({
  task,
  channelId,
  onClose,
  onToggleCollapsed,
  onOpenFull,
  showTaskSummary,
  focusMessageId,
}: {
  task: Task;
  channelId: string;
  onClose?: () => void;
  onToggleCollapsed?: () => void;
  onOpenFull?: () => void;
  showTaskSummary: boolean;
  /** Thread message to scroll to and pulse once (e.g. an Activity mention). */
  focusMessageId?: string;
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
  const { items } = useConversationItems(events, isPromptPending);
  const pendingPermissions = usePendingPermissionsForTask(taskId);
  const agentMsgs = useMemo(() => agentTurns(items), [items]);
  const promptMsgs = useMemo(() => agentPrompts(items), [items]);

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

  const timeline = useMemo(
    () =>
      buildThreadTimeline({
        prompts: promptMsgs,
        agentMessages: agentMsgs,
        humanMessages: messages.map((message) => ({
          id: message.id,
          content: message.content,
          createdAt: message.created_at,
          forwardedToAgent: !!message.forwarded_to_agent_at,
          value: message,
        })),
      }),
    [promptMsgs, messages, agentMsgs],
  );

  const lastAgentId = agentMsgs[agentMsgs.length - 1]?.id;

  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [highlightId, setHighlightId] = useState<string | undefined>(undefined);
  // The mention we've already scrolled to; guards against re-scrolling/pulsing
  // when the same notification is clicked again (the id doesn't change).
  const focusedRef = useRef<string | undefined>(undefined);
  const isReady = !isInitializing && !isLoading;

  // Show a jump-to-latest pill when the viewport is scrolled up off the bottom
  // (same geometry the quill scroller uses: gap below the fold > threshold).
  const [showJump, setShowJump] = useState(false);
  const syncAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowJump(el.scrollHeight - el.scrollTop - el.clientHeight > 100);
  }, []);

  const handleMentionInsert = useCallback(
    (member: UserBasic) => {
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "mention_member",
        surface: "thread_panel",
        task_id: taskId,
        mentioned_user_id: member.uuid,
      });
    },
    [taskId],
  );

  // Auto-scroll to the newest message. Suppressed entirely for a deep-linked
  // view: a long thread keeps growing (agent turns, streaming) after the
  // mention is focused, and any bottom-snap here would yank the view off it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when rendered thread content changes
  useEffect(() => {
    if (focusMessageId) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [timeline, agentStatus?.phase]);

  // Scroll to a deep-linked mention and pulse it. Keeps re-centering on later
  // timeline changes while the pulse is active, so content loading in above the
  // target (agent turns arrive after the thread's human messages) can't drift
  // it off-screen. Once the pulse clears we stop touching the scroll, and a
  // re-click of the same already-settled message is a no-op (focusedRef).
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-check as the timeline renders/reflows the target
  useEffect(() => {
    if (!focusMessageId || !isReady) return;
    const alreadyFocused = focusedRef.current === focusMessageId;
    // Settled (pulse finished): leave the user's scroll position alone.
    if (alreadyFocused && highlightId !== focusMessageId) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(
      `[data-thread-message-id="${CSS.escape(focusMessageId)}"]`,
    );
    if (!el) return; // not rendered yet; the timeline dep re-runs us when it is
    focusedRef.current = focusMessageId;
    // Scroll after paint so the row's real geometry is measured.
    const raf = requestAnimationFrame(() =>
      el.scrollIntoView({ block: "center" }),
    );
    if (!alreadyFocused) setHighlightId(focusMessageId);
    return () => cancelAnimationFrame(raf);
  }, [focusMessageId, isReady, timeline, highlightId]);

  // Clear the pulse after it plays. Keyed on highlightId (not the scroll
  // effect) so a message arriving mid-pulse can't strand the highlight on.
  useEffect(() => {
    if (!highlightId) return;
    const timer = setTimeout(() => setHighlightId(undefined), 1600);
    return () => clearTimeout(timer);
  }, [highlightId]);

  // Recompute the jump pill after content grows or an effect above moves the
  // scroll. Declared last so it reads the settled scrollTop.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sync as rendered content changes
  useEffect(() => {
    syncAtBottom();
  }, [timeline, agentStatus?.phase, isReady, syncAtBottom]);

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

  const handleSendToAgent = (messageId: string) => {
    sendToAgent(messageId).catch((error: unknown) => {
      toast.error("Couldn't send message to agent", {
        description: error instanceof Error ? error.message : String(error),
      });
    });
  };

  const handleDelete = (messageId: string) => {
    deleteMessage(messageId).catch((error: unknown) => {
      toast.error("Couldn't delete message", {
        description: error instanceof Error ? error.message : String(error),
      });
    });
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-gray-1">
      <ThreadHeader
        onOpenFull={onOpenFull}
        onToggleCollapsed={onToggleCollapsed}
        onClose={onClose}
      />

      {showTaskSummary && (
        <div className="z-10 px-2">
          <TaskCard task={task} channelId={channelId} inThread />
        </div>
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          onScroll={syncAtBottom}
          className="h-full overflow-y-auto"
        >
          <ThreadTimeline
            timeline={timeline}
            isReady={isReady}
            taskAuthor={task.created_by}
            currentUserUuid={currentUser?.uuid}
            currentUserEmail={currentUser?.email}
            isTaskAuthor={isTaskAuthor}
            canForward={canForward}
            lastAgentId={lastAgentId}
            agentActive={agentStatus?.phase === "active"}
            highlightId={highlightId}
            onSendToAgent={handleSendToAgent}
            onDelete={handleDelete}
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="Scroll to latest"
          onClick={() => {
            const el = scrollRef.current;
            el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
          }}
          className={`-translate-x-1/2 absolute bottom-3 left-1/2 z-10 rounded-full bg-background shadow-md transition-[opacity,scale] duration-200 hover:bg-background! ${
            showJump
              ? "scale-100 opacity-100"
              : "pointer-events-none scale-95 opacity-0"
          }`}
        >
          <ArrowDownIcon size={14} />
        </Button>
      </div>

      {agentStatus && <AgentStatusLine status={agentStatus} />}

      <ThreadReplyComposer
        draft={draft}
        onDraftChange={setDraft}
        onSubmit={submit}
        members={members}
        allowAgentMention={isTaskAuthor && canForward}
        onMentionInsert={handleMentionInsert}
        disabled={!draft.trim() || isPosting || isSendingToAgent}
      />
    </div>
  );
}

export function ThreadPanel({
  taskId,
  channelId,
  task: taskProp,
  onClose,
  collapsed,
  onToggleCollapsed,
  onOpenFull,
  showTaskSummary = true,
  focusMessageId,
}: {
  taskId: string;
  channelId: string;
  task?: Task;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onOpenFull?: () => void;
  showTaskSummary?: boolean;
  /** Thread message to scroll to and pulse once (e.g. an Activity mention). */
  focusMessageId?: string;
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
          aria-label="Expand thread"
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
    <ThreadConversation
      task={task}
      channelId={channelId}
      onClose={onClose}
      onToggleCollapsed={onToggleCollapsed}
      onOpenFull={onOpenFull}
      showTaskSummary={showTaskSummary}
      focusMessageId={focusMessageId}
    />
  );
}
