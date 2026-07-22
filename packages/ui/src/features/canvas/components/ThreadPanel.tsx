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
  hasAgentMention,
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
import { MentionText } from "@posthog/ui/features/canvas/components/MentionText";
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
  const authorKind = message.author_kind ?? "human";
  const isAgent = authorKind === "agent";
  const isSystem = authorKind === "system";
  const showMenu =
    authorKind === "human" && ((isTaskAuthor && !forwarded) || isOwnMessage);

  return (
    <ThreadItem>
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
  currentUserUuid,
  currentUserEmail,
  isTaskAuthor,
  canForward,
  onSendToAgent,
  onDelete,
}: {
  timeline: ThreadTimelineRow<TaskThreadMessage>[];
  isReady: boolean;
  currentUserUuid?: string;
  currentUserEmail?: string;
  isTaskAuthor: boolean;
  canForward: boolean;
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
            Discuss this task with your team. Messages stay between humans
            unless the task author sends one to the agent.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ThreadItemGroup>
      {timeline.map((row) => (
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
          onSendToAgent={() => onSendToAgent(row.message.id)}
          onDelete={() => onDelete(row.message.id)}
        />
      ))}
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

  const timeline = useMemo(
    () =>
      buildThreadTimeline({
        humanMessages: messages.map((message) => ({
          id: message.id,
          content: message.content,
          createdAt: message.created_at,
          forwardedToAgent: !!message.forwarded_to_agent_at,
          value: message,
        })),
      }),
    [messages],
  );

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
  }, [timeline]);

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

  const isReady = !isLoading;

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
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <ThreadTimeline
          timeline={timeline}
          isReady={isReady}
          currentUserUuid={currentUser?.uuid}
          currentUserEmail={currentUser?.email}
          isTaskAuthor={isTaskAuthor}
          canForward={canForward}
          onSendToAgent={handleSendToAgent}
          onDelete={handleDelete}
        />
      </div>

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
    />
  );
}
