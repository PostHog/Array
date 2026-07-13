import type { Task } from "@posthog/shared/domain-types";
import { ThreadSidebar } from "@posthog/ui/features/canvas/components/ThreadSidebar";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useThreadPanelStore } from "@posthog/ui/features/canvas/stores/threadPanelStore";
import { useTaskViewed } from "@posthog/ui/features/sidebar/useTaskViewed";
import { TaskDetail } from "@posthog/ui/features/task-detail/components/TaskDetail";
import {
  getCachedTask,
  getCachedTaskDetail,
  taskDetailQuery,
} from "@posthog/ui/features/tasks/queries";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import { TaskDetailSkeleton } from "@posthog/ui/router/routeSkeletons";
import { yieldToPaint } from "@posthog/ui/router/yieldToPaint";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/website/$channelId/tasks/$taskId")({
  component: ChannelTaskDetailRoute,
  pendingComponent: TaskDetailSkeleton,
  // Cache-only loader (same as /code/tasks/$taskId): never block navigation on
  // the network; the cold-miss fetch lives in the component. The single-frame
  // yield lets the skeleton paint before TaskDetail's heavy mount.
  loader: async ({ params }): Promise<Task | null> => {
    const task =
      getCachedTaskDetail(params.taskId) ??
      getCachedTask(params.taskId) ??
      null;
    await yieldToPaint();
    return task;
  },
});

function ChannelTaskDetailRoute() {
  const { channelId, taskId } = Route.useParams();
  const loaderTask = Route.useLoaderData();
  const { data: tasks } = useTasks();
  const fromList = tasks?.find((t) => t.id === taskId);
  const { channels } = useChannels();
  const channelName = channels.find((c) => c.id === channelId)?.name;

  // The channels space doesn't mount SidebarMenu (which marks code-space tasks
  // viewed on open), so mark it viewed here. Clears the task's unread state and
  // lets a canvas's generation task drop out of the nested sidebar row once the
  // user has actually looked at it.
  const { markAsViewed } = useTaskViewed();
  useEffect(() => {
    markAsViewed(taskId);
  }, [taskId, markAsViewed]);

  // Opening a task shows its thread docked on the right, keeping the user's
  // collapse preference. The panel follows the task being viewed.
  const openThread = useThreadPanelStore((s) => s.openThread);
  useEffect(() => {
    openThread(taskId, { expand: false });
  }, [openThread, taskId]);

  const { data: fetched } = useQuery({
    ...taskDetailQuery(taskId),
    enabled: !fromList && !loaderTask,
  });

  const task = fromList ?? loaderTask ?? fetched;

  if (!task) {
    return <TaskDetailSkeleton />;
  }

  return (
    <div className="flex h-full min-w-0">
      <div className="min-w-0 flex-1">
        <TaskDetail
          key={task.id}
          task={task}
          channelName={channelName ?? "Channel"}
          channelId={channelId}
        />
      </div>
      <ThreadSidebar taskId={taskId} task={task} showTaskTitle={false} />
    </div>
  );
}
