import type { TaskThreadMessage } from "@posthog/shared/domain-types";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

const THREAD_POLL_INTERVAL_MS = 5_000;

export function taskThreadQueryKey(taskId: string | undefined) {
  return ["task-thread", taskId ?? "none"] as const;
}

/** A task's thread — the human side conversation — in chronological order. */
export function useTaskThread(
  taskId: string | undefined,
  options?: {
    /** Poll cadence override; feed rows poll slower than the open panel. */
    pollIntervalMs?: number;
  },
): {
  messages: TaskThreadMessage[];
  isLoading: boolean;
} {
  const pollIntervalMs = options?.pollIntervalMs ?? THREAD_POLL_INTERVAL_MS;
  const query = useAuthenticatedQuery<TaskThreadMessage[]>(
    taskThreadQueryKey(taskId),
    (client) => client.getTaskThreadMessages(taskId as string),
    {
      enabled: !!taskId,
      refetchInterval: pollIntervalMs,
      // Fresh-within-the-poll-window so focus/remount doesn't refire every
      // feed row's thread query on top of the interval.
      staleTime: pollIntervalMs,
    },
  );
  return { messages: query.data ?? [], isLoading: query.isLoading };
}

export function useTaskThreadMutations(taskId: string | undefined) {
  const client = useOptionalAuthenticatedClient();
  const queryClient = useQueryClient();

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: taskThreadQueryKey(taskId),
    });
  }, [queryClient, taskId]);

  const postMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!client || !taskId) throw new Error("Not authenticated");
      return client.createTaskThreadMessage(taskId, content);
    },
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: async (messageId: string) => {
      if (!client || !taskId) throw new Error("Not authenticated");
      return client.deleteTaskThreadMessage(taskId, messageId);
    },
    onSuccess: invalidate,
  });

  const sendToAgentMutation = useMutation({
    mutationFn: async (messageId: string) => {
      if (!client || !taskId) throw new Error("Not authenticated");
      return client.sendTaskThreadMessageToAgent(taskId, messageId);
    },
    onSuccess: invalidate,
  });

  return {
    postMessage: (content: string) => postMutation.mutateAsync(content),
    deleteMessage: (messageId: string) => deleteMutation.mutateAsync(messageId),
    sendToAgent: (messageId: string) =>
      sendToAgentMutation.mutateAsync(messageId),
    isPosting: postMutation.isPending,
    isSendingToAgent: sendToAgentMutation.isPending,
  };
}
