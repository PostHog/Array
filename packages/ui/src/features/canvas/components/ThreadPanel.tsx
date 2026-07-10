import {
  CaretRightIcon,
  DotsThreeIcon,
  PaperPlaneRightIcon,
  RobotIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
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
  Spinner,
} from "@posthog/quill";
import { formatRelativeTimeShort } from "@posthog/shared";
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
import { MentionComposer } from "@posthog/ui/features/canvas/components/MentionComposer";
import { MentionText } from "@posthog/ui/features/canvas/components/MentionText";
import { useOrgMembers } from "@posthog/ui/features/canvas/hooks/useOrgMembers";
import {
  useTaskThread,
  useTaskThreadMutations,
} from "@posthog/ui/features/canvas/hooks/useTaskThread";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import { taskDetailQuery } from "@posthog/ui/features/tasks/queries";
import { toast } from "@posthog/ui/primitives/toast";
import { track } from "@posthog/ui/shell/analytics";
import { Text } from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

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
  /** Whether the current user authored the task (may forward to the agent). */
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
    <div className="group flex gap-2 rounded-md px-2 py-1.5 hover:bg-fill-secondary">
      <Avatar size="xs" className="mt-0.5 shrink-0">
        <AvatarFallback>{getUserInitials(message.author)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <Text size="1" weight="medium" className="truncate">
            {userDisplayName(message.author)}
          </Text>
          <Text size="1" className="shrink-0 text-muted-foreground">
            {formatRelativeTimeShort(message.created_at)}
          </Text>
        </div>
        <MentionText
          content={message.content}
          currentUserEmail={currentUserEmail}
          className="block whitespace-pre-wrap break-words"
        />
        {forwarded && (
          <Badge variant="info" className="mt-1">
            <RobotIcon size={10} />
            Sent to agent
          </Badge>
        )}
      </div>
      {showMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="default"
                size="icon-xs"
                aria-label="Message actions"
                className="opacity-0 transition-opacity group-hover:opacity-100 data-popup-open:opacity-100"
              >
                <DotsThreeIcon size={14} />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            {isTaskAuthor && !forwarded && (
              <DropdownMenuItem disabled={!canForward} onClick={onSendToAgent}>
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
      )}
    </div>
  );
}

// The right-hand thread dock: the human-only conversation around a task.
// Nothing here reaches the agent unless the task author explicitly forwards a
// message ("Send to agent" in the row's hover menu).
export function ThreadPanel({
  taskId,
  task: taskProp,
  onClose,
  collapsed,
  onToggleCollapsed,
  showTaskTitle = true,
}: {
  taskId: string;
  /** The thread's task when the caller already has it; fetched otherwise. */
  task?: Task;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /**
   * Show the task title under the "Thread" heading. Hidden in the task detail
   * view, where the TaskDetail header already names the task.
   */
  showTaskTitle?: boolean;
}) {
  const client = useOptionalAuthenticatedClient();
  const { data: currentUser } = useCurrentUser({ client });
  const { data: fetchedTask } = useQuery({
    ...taskDetailQuery(taskId),
    enabled: !taskProp,
  });
  const task = taskProp ?? fetchedTask;

  const { messages, isLoading } = useTaskThread(collapsed ? undefined : taskId);
  const {
    postMessage,
    deleteMessage,
    sendToAgent,
    isPosting,
    isSendingToAgent,
  } = useTaskThreadMutations(taskId);
  const { members } = useOrgMembers({ enabled: !collapsed });

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

  // Keep the newest message in view, Slack-style.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  const isTaskAuthor =
    !!currentUser?.uuid && currentUser.uuid === task?.created_by?.uuid;
  // Forwarding needs a run the workflow can still signal, one send at a time.
  const canForward =
    !!task?.latest_run &&
    !isTerminalStatus(task.latest_run.status) &&
    !isSendingToAgent;

  const submit = () => {
    const content = draft.trim();
    if (!content || isPosting) return;
    setDraft("");
    postMessage(content).catch((error: unknown) => {
      setDraft(content);
      toast.error("Couldn't post message", {
        description: error instanceof Error ? error.message : String(error),
      });
    });
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

  return (
    <div className="flex h-full min-w-0 flex-col bg-gray-1">
      <div className="flex items-center gap-1 border-border border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          <Text size="2" weight="medium" className="block">
            Thread
          </Text>
          {showTaskTitle && task && (
            <Text size="1" className="block truncate text-muted-foreground">
              {task.title || "Untitled task"}
            </Text>
          )}
        </div>
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

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2">
        {isLoading && messages.length === 0 ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : messages.length === 0 ? (
          <div className="px-2 py-6 text-center">
            <Text size="1" className="text-muted-foreground">
              Discuss this task with your team. Messages stay between humans
              unless the task author sends one to the agent.
            </Text>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {messages.map((message) => (
              <ThreadMessageRow
                key={message.id}
                message={message}
                isTaskAuthor={isTaskAuthor}
                isOwnMessage={
                  !!currentUser?.uuid &&
                  currentUser.uuid === message.author?.uuid
                }
                currentUserEmail={currentUser?.email}
                canForward={canForward}
                onSendToAgent={() => handleSendToAgent(message.id)}
                onDelete={() => handleDelete(message.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="border-border border-t p-2">
        <MentionComposer
          value={draft}
          onValueChange={setDraft}
          onSubmit={submit}
          members={members}
          onMentionInsert={handleMentionInsert}
          placeholder="Reply in thread… @ to tag a teammate"
          rows={2}
          inputClassName="max-h-40 text-[13px]"
        >
          <InputGroupAddon align="block-end" className="p-1">
            <span className="ml-auto flex items-center gap-1">
              <InputGroupButton
                variant="primary"
                size="icon-sm"
                aria-label="Send"
                disabled={!draft.trim() || isPosting}
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
