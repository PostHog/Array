import {
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
  InputGroupAddon,
  InputGroupButton,
  Skeleton,
  SkeletonText,
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
import { useOrgMembers } from "@posthog/ui/features/canvas/hooks/useOrgMembers";
import {
  useTaskThread,
  useTaskThreadMutations,
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

function ThreadMessageRow({
  message,
  isTaskAuthor,
  isOwnMessage,
  currentUserEmail,
  canForward,
  onSendToAgent,
  onDelete,
}: {
  message: TaskThreadMessage;
  isTaskAuthor: boolean;
  isOwnMessage: boolean;
  currentUserEmail?: string | null;
  canForward: boolean;
  onSendToAgent: () => void;
  onDelete: () => void;
}) {
  const forwarded = !!message.forwarded_to_agent_at;
  const showMenu = (isTaskAuthor && !forwarded) || isOwnMessage;

  return (
    <ThreadItem>
      <ThreadItemGutter>
        <Avatar size="lg" className="sticky top-2">
          <AvatarFallback>{getUserInitials(message.author)}</AvatarFallback>
        </Avatar>
      </ThreadItemGutter>
      <ThreadItemContent>
        <ThreadItemHeader>
          <ThreadItemAuthor>{userDisplayName(message.author)}</ThreadItemAuthor>
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

function agentTurns(items: ConversationItem[]): ThreadAgentMessage[] {
  const turns: ThreadAgentMessage[] = [];
  let current: ThreadAgentMessage | null = null;
  for (const item of items) {
    if (item.type === "user_message") {
      if (current) turns.push(current);
      current = null;
      continue;
    }
    if (
      item.type === "session_update" &&
      item.update.sessionUpdate === "agent_message_chunk" &&
      "content" in item.update &&
      item.update.content.type === "text" &&
      item.update.content.text.trim()
    ) {
      current = {
        id: item.id,
        text: item.update.content.text,
        timestamp: item.timestamp,
      };
    }
  }
  if (current) turns.push(current);
  return turns;
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

function AgentStatusChip({ status }: { status: ThreadAgentStatus }) {
  switch (status.phase) {
    case "active":
      return (
        <span className="flex items-center gap-1 text-muted-foreground">
          <Spinner className="size-3" />
          <span className="text-xs">{status.label}</span>
        </span>
      );
    case "needs_input":
      return <Badge variant="warning">{status.label}</Badge>;
    case "error":
      return <Badge variant="destructive">{status.label}</Badge>;
    default:
      return <Badge variant="success">{status.label}</Badge>;
  }
}

export function AgentTurnRow({
  message,
  status,
  streaming,
}: {
  message?: ThreadAgentMessage;
  status?: ThreadAgentStatus;
  streaming: boolean;
}) {
  return (
    <ThreadItem>
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
          {message?.timestamp !== undefined && (
            <ThreadTimestamp
              dateTime={new Date(message.timestamp).toISOString()}
            />
          )}
        </ThreadItemHeader>
        {(message?.text || status) && (
          <ThreadItemBody>
            <div className="rounded-md border border-border bg-muted px-2 py-1.5">
              {message?.text &&
                (streaming ? (
                  <ChatStreamingMarkdown content={message.text} />
                ) : (
                  <ChatMarkdown content={message.text} />
                ))}
              {status && (
                <div className={message?.text ? "mt-2" : undefined}>
                  <AgentStatusChip status={status} />
                </div>
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
}: {
  message: ThreadAgentMessage;
  author: TaskThreadMessage["author"];
}) {
  const promptText = normalizeAgentPromptText(message.text);

  return (
    <ThreadItem>
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

function ThreadTimelineSkeleton() {
  return (
    <ThreadItemGroup aria-hidden>
      {[0, 1, 2].map((i) => (
        <ThreadItem key={i}>
          <ThreadItemGutter>
            <Skeleton className="size-8 rounded-full" />
          </ThreadItemGutter>
          <ThreadItemContent>
            <ThreadItemHeader>
              <Skeleton className="h-3.5 w-24 rounded" />
            </ThreadItemHeader>
            <SkeletonText lines={i === 1 ? 3 : 2} />
          </ThreadItemContent>
        </ThreadItem>
      ))}
    </ThreadItemGroup>
  );
}

function ThreadConversation({
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
  const {
    postMessage,
    postMessageToAgent,
    deleteMessage,
    sendToAgent,
    isPosting,
    isSendingToAgent,
  } = useTaskThreadMutations(taskId);
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
  const prUrl =
    typeof task.latest_run?.output?.pr_url === "string"
      ? task.latest_run.output.pr_url
      : undefined;

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
        hasPullRequest: !!prUrl,
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
      prUrl,
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when rendered thread content changes
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [timeline, agentStatus?.phase]);

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

  const isEmpty = timeline.length === 0 && !agentStatus;
  const isReady = !isInitializing && !isLoading;

  return (
    <div className="flex h-full min-w-0 flex-col bg-gray-1">
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

      {showTaskSummary && (
        <div className="z-10 px-2">
          <TaskCard task={task} channelId={channelId} inThread />
        </div>
      )}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {!isReady ? (
          <ThreadTimelineSkeleton />
        ) : isEmpty ? (
          <div className="px-2 py-6 text-center">
            <p className="text-muted-foreground text-xs">
              Discuss this task with your team. The agent's status shows up here
              too; messages stay between humans unless the task author sends one
              to the agent.
            </p>
          </div>
        ) : (
          <ThreadItemGroup>
            {timeline.map((row) =>
              row.kind === "prompt" ? (
                <UserPromptRow
                  key={row.message.id}
                  message={row.message}
                  author={task.created_by}
                />
              ) : row.kind === "human" ? (
                <ThreadMessageRow
                  key={row.message.id}
                  message={row.message.value as TaskThreadMessage}
                  isTaskAuthor={isTaskAuthor}
                  isOwnMessage={
                    !!currentUser?.uuid &&
                    currentUser.uuid === row.message.value?.author?.uuid
                  }
                  currentUserEmail={currentUser?.email}
                  canForward={canForward}
                  onSendToAgent={() => handleSendToAgent(row.message.id)}
                  onDelete={() => handleDelete(row.message.id)}
                />
              ) : (
                <AgentTurnRow
                  key={row.message.id}
                  message={row.message}
                  streaming={
                    row.message.id === lastAgentId &&
                    agentStatus?.phase === "active"
                  }
                />
              ),
            )}
            {agentStatus && !(agentStatus.phase === "complete" && !!prUrl) && (
              <AgentTurnRow status={agentStatus} streaming={false} />
            )}
          </ThreadItemGroup>
        )}
      </div>

      <div className="border-border border-t p-2">
        <MentionComposer
          value={draft}
          onValueChange={setDraft}
          onSubmit={submit}
          members={members}
          allowAgentMention={isTaskAuthor && canForward}
          onMentionInsert={handleMentionInsert}
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
                disabled={!draft.trim() || isPosting || isSendingToAgent}
                onClick={submit}
              >
                <PaperPlaneRightIcon size={14} />
              </InputGroupButton>
            </span>
          </InputGroupAddon>
        </MentionComposer>
      </div>
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
          aria-label="Expand thread"
          onClick={onToggleCollapsed}
        >
          <CaretRightIcon size={14} className="rotate-180" />
        </Button>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex h-full min-w-0 flex-col items-center justify-center bg-gray-1">
        <Spinner />
      </div>
    );
  }

  return (
    <ThreadConversation
      task={task}
      channelId={channelId}
      onClose={onClose}
      onToggleCollapsed={onToggleCollapsed}
      onOpenFull={onOpenFull}
      showTaskSummary={showTaskSummary}
    />
  );
}
