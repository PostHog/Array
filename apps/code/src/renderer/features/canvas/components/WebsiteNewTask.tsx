import { useChannelTasksStore } from "@features/canvas/stores/websiteTasksStore";
import { TaskInput } from "@features/task-detail/components/TaskInput";
import { taskDetailQuery } from "@features/tasks/queries";
import type { Task } from "@shared/types";
import { useNavigate } from "@tanstack/react-router";
import { queryClient } from "@utils/queryClient";
import { useCallback } from "react";

// A channel's "New task" view. Reuses /code's TaskInput, but routes the created
// task into the channel (/website/$channelId/tasks/$id) instead of /code.
export function WebsiteNewTask({ channelId }: { channelId: string }) {
  const navigate = useNavigate();
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
    [channelId, addTask, navigate],
  );

  return <TaskInput onTaskCreated={onTaskCreated} />;
}
