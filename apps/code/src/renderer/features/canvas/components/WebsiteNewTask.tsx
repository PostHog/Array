import { useWebsiteTasksStore } from "@features/canvas/stores/websiteTasksStore";
import { TaskInput } from "@features/task-detail/components/TaskInput";
import { taskDetailQuery } from "@features/tasks/queries";
import type { Task } from "@shared/types";
import { useNavigate } from "@tanstack/react-router";
import { queryClient } from "@utils/queryClient";
import { useCallback } from "react";

// The Website space's "New task" view. Reuses /code's TaskInput, but routes the
// created task into the Website space (/website/tasks/$id) instead of /code.
export function WebsiteNewTask() {
  const navigate = useNavigate();
  const addTask = useWebsiteTasksStore((s) => s.addTask);

  const onTaskCreated = useCallback(
    (task: Task) => {
      // Seed the detail cache so the destination route resolves instantly
      // (mirrors openTask), then track + navigate within the Website space.
      queryClient.setQueryData(taskDetailQuery(task.id).queryKey, task);
      addTask(task.id);
      void navigate({
        to: "/website/tasks/$taskId",
        params: { taskId: task.id },
      });
    },
    [addTask, navigate],
  );

  return <TaskInput onTaskCreated={onTaskCreated} />;
}
