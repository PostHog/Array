import {
  buildThreadTimeline,
  deriveThreadAgentStatus,
  hasAgentMention,
  shouldSuspendThreadSession,
  type ThreadAgentStatus,
  type ThreadTimelineRow,
} from "@posthog/core/canvas/threadTimeline";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import type {
  Task,
  TaskThreadMessage,
  UserBasic,
} from "@posthog/shared/domain-types";
import { isTerminalStatus } from "@posthog/shared/domain-types";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useCurrentUser } from "@posthog/ui/features/auth/useCurrentUser";
import { useOrgMembers } from "@posthog/ui/features/canvas/hooks/useOrgMembers";
import {
  useDeleteTaskThreadMessage,
  usePostTaskThreadMessage,
  usePostTaskThreadMessageToAgent,
  useSendTaskThreadMessageToAgent,
  useTaskThread,
} from "@posthog/ui/features/canvas/hooks/useTaskThread";
import { useSessionConnection } from "@posthog/ui/features/sessions/hooks/useSessionConnection";
import { useSessionViewState } from "@posthog/ui/features/sessions/hooks/useSessionViewState";
import { usePendingPermissionsForTask } from "@posthog/ui/features/sessions/sessionStore";
import { toast } from "@posthog/ui/primitives/toast";
import { track } from "@posthog/ui/shell/analytics";
import { useCallback, useMemo, useState } from "react";

/** Which panel is asking, for analytics. The only difference between them. */
export type ThreadSurface = "thread_panel" | "activity_panel";

type SessionEvents = ReturnType<typeof useSessionViewState>["events"];

export interface ThreadConversation {
  timeline: ThreadTimelineRow<TaskThreadMessage>[];
  agentStatus: ThreadAgentStatus | null;
  /** Session events behind the timeline, for panels that render them. */
  events: SessionEvents;
  isPromptPending: boolean;
  /** The thread and its session have both settled. */
  isReady: boolean;
  members: UserBasic[];
  currentUser: { uuid?: string; email?: string } | undefined;
  isTaskAuthor: boolean;
  /** The task has a live run that a message could still be forwarded to. */
  canForward: boolean;
  draft: string;
  setDraft: (value: string) => void;
  /** Composer disabled state — empty draft or a post in flight. */
  isSubmitDisabled: boolean;
  submit: () => Promise<void>;
  sendMessageToAgent: (messageId: string) => void;
  deleteMessage: (messageId: string) => void;
  onMentionInsert: (member: UserBasic) => void;
}

/**
 * Everything a task-thread panel needs: the timeline, the agent's status, and
 * the posting rules.
 *
 * Shared by ThreadPanel and the flag-gated ActivityPanel, which are otherwise
 * two renderings of the same conversation. The rules here — only the task author
 * may @agent while a run is live, a failed post hands the draft back — are the
 * kind that must not exist twice, since only one copy would get the fix.
 */
export function useThreadConversation(
  task: Task,
  { surface }: { surface: ThreadSurface },
): ThreadConversation {
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

  const [draft, setDraft] = useState("");

  const onMentionInsert = useCallback(
    (member: UserBasic) => {
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "mention_member",
        surface,
        task_id: taskId,
        mentioned_user_id: member.uuid,
      });
    },
    [taskId, surface],
  );

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
      // Hand the draft back rather than losing what they typed.
      setDraft(content);
      toast.error("Couldn't post message", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const sendMessageToAgent = (messageId: string) => {
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

  return {
    timeline,
    agentStatus,
    events,
    isPromptPending,
    isReady: !isInitializing && !isLoading,
    members,
    currentUser,
    isTaskAuthor,
    canForward,
    draft,
    setDraft,
    isSubmitDisabled: !draft.trim() || isPosting || isSendingToAgent,
    submit,
    sendMessageToAgent,
    deleteMessage: handleDelete,
    onMentionInsert,
  };
}
