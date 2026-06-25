import type { Task } from "@posthog/shared/domain-types";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useTaskViewed } from "@posthog/ui/features/sidebar/useTaskViewed";
import { TaskDetail } from "@posthog/ui/features/task-detail/components/TaskDetail";
import {
  getCachedTask,
  getCachedTaskDetail,
  taskDetailQuery,
} from "@posthog/ui/features/tasks/queries";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import { RoutePending } from "@posthog/ui/router/RoutePending";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/website/$channelId/tasks/$taskId")({
  component: ChannelTaskDetailRoute,
  // Cache-only loader (same as /code/tasks/$taskId): never block navigation on
  // the network; the cold-miss fetch lives in the component.
  loader: ({ params }): Task | null =>
    getCachedTaskDetail(params.taskId) ?? getCachedTask(params.taskId) ?? null,
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

  const { data: fetched } = useQuery({
    ...taskDetailQuery(taskId),
    enabled: !fromList && !loaderTask,
  });

  const task = fromList ?? loaderTask ?? fetched;

  if (!task) {
    return <RoutePending />;
  }

  return (
    <TaskDetail
      key={task.id}
      task={task}
      channelName={channelName ?? "Channel"}
    />
  );
}
