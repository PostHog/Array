import type { Task } from "@posthog/shared/domain-types";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useChannelTaskMutations } from "@posthog/ui/features/canvas/hooks/useChannelTasks";
import { useFolderInstructions } from "@posthog/ui/features/canvas/hooks/useFolderInstructions";
import { TaskInput } from "@posthog/ui/features/task-detail/components/TaskInput";
import { taskDetailQuery } from "@posthog/ui/features/tasks/queries";
import { toast } from "@posthog/ui/primitives/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

// A channel's "New task" view. Reuses /code's TaskInput, but routes the created
// task into the channel (/website/$channelId/tasks/$id) instead of /code, and
// files the task to the channel by creating an extra `task` row under the
// channel folder on the project's desktop_file_system surface.
export function WebsiteNewTask({ channelId }: { channelId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { fileTask } = useChannelTaskMutations();
  const { channels } = useChannels();
  const channelName = channels.find((c) => c.id === channelId)?.name;
  // The channel's CONTEXT.md, passed to the agent as optional background so
  // tasks created here start with the shared context. Absent/empty is fine.
  const { data: instructions } = useFolderInstructions(channelId);

  const onTaskCreated = useCallback(
    (task: Task) => {
      // Seed the detail cache so the destination route resolves instantly
      // (mirrors openTask), then file to the channel + navigate.
      queryClient.setQueryData(taskDetailQuery(task.id).queryKey, task);
      void fileTask(channelId, task.id, task.title).catch((error: unknown) => {
        toast.error("Couldn't file task to channel", {
          description: error instanceof Error ? error.message : String(error),
        });
      });
      void navigate({
        to: "/website/$channelId/tasks/$taskId",
        params: { channelId, taskId: task.id },
      });
    },
    [channelId, fileTask, navigate, queryClient],
  );

  return (
    <TaskInput
      onTaskCreated={onTaskCreated}
      channelContext={instructions?.content}
      channelName={channelName}
    />
  );
}
