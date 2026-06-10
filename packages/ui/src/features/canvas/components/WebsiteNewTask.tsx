import type { Task } from "@posthog/shared/domain-types";
import { useChannelTasksStore } from "@posthog/ui/features/canvas/stores/websiteTasksStore";
import { TaskInput } from "@posthog/ui/features/task-detail/components/TaskInput";
import { taskDetailQuery } from "@posthog/ui/features/tasks/queries";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

// A channel's "New task" view. Reuses /code's TaskInput, but routes the created
// task into the channel (/website/$channelId/tasks/$id) instead of /code.
export function WebsiteNewTask({ channelId }: { channelId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const addTask = useChannelTasksStore((s) => s.addTask);

  const onTaskCreated = useCallback(
    (task: Task) => {
      // Seed the detail cache so the destination route resolves instantly
      // (mirrors openTask), then track + navigate within the channel.
      queryClient.setQueryData(taskDetailQuery(task.id).queryKey, task);
      addTask(channelId, task.id);
      void navigate({
        to: "/website/$channelId/tasks/$taskId",
        params: { channelId, taskId: task.id },
      });
    },
    [channelId, addTask, navigate, queryClient],
  );

  return <TaskInput onTaskCreated={onTaskCreated} />;
}
