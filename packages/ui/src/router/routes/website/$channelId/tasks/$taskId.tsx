import type { Task } from "@posthog/shared/domain-types";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
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
