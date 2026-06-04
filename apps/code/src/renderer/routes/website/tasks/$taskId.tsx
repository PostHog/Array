import { RoutePending } from "@components/RoutePending";
import { TaskDetail } from "@features/task-detail/components/TaskDetail";
import { useTasks } from "@features/tasks/hooks/useTasks";
import { taskDetailQuery } from "@features/tasks/queries";
import type { Task } from "@shared/types";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { getCachedTask } from "@utils/queryClient";

export const Route = createFileRoute("/website/tasks/$taskId")({
  component: WebsiteTaskDetailRoute,
  // Cache-only loader (same as /code/tasks/$taskId): never block navigation on
  // the network; the cold-miss fetch lives in the component.
  loader: ({ context, params }): Task | null => {
    const key = taskDetailQuery(params.taskId).queryKey;
    return (
      context.queryClient.getQueryData<Task>(key) ??
      getCachedTask(params.taskId) ??
      null
    );
  },
});

function WebsiteTaskDetailRoute() {
  const { taskId } = Route.useParams();
  const loaderTask = Route.useLoaderData();
  const { data: tasks } = useTasks();
  const fromList = tasks?.find((t) => t.id === taskId);

  const { data: fetched } = useQuery({
    ...taskDetailQuery(taskId),
    enabled: !fromList && !loaderTask,
  });

  const task = fromList ?? loaderTask ?? fetched;

  if (!task) {
    return <RoutePending />;
  }

  return <TaskDetail key={task.id} task={task} />;
}
