import type { Task } from "@posthog/shared/domain-types";
import { CHANNEL_NEEDS_FEEDBACK_STATE_KEY } from "@posthog/ui/features/canvas/utils/channelBoardStatus";
import { useAuthenticatedMutation } from "@posthog/ui/hooks/useAuthenticatedMutation";
import { useQueryClient } from "@tanstack/react-query";

export function useChannelFeedbackRequest(): {
  setNeedsFeedback: (task: Task, value: boolean) => Promise<void>;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const mutation = useAuthenticatedMutation(
    (client, { task, value }: { task: Task; value: boolean }) => {
      if (!task.latest_run) throw new Error("Task has no run to update");
      return client.updateTaskRun(task.id, task.latest_run.id, {
        state: {
          ...task.latest_run.state,
          [CHANNEL_NEEDS_FEEDBACK_STATE_KEY]: value,
        },
      });
    },
    {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: ["channel-feed"] }),
    },
  );

  return {
    setNeedsFeedback: async (task, value) => {
      await mutation.mutateAsync({ task, value });
    },
    isPending: mutation.isPending,
  };
}
