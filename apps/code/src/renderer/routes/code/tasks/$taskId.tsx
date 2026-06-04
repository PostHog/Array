import { RoutePending } from "@components/RoutePending";
import { TaskDetail } from "@features/task-detail/components/TaskDetail";
import { useTasks } from "@features/tasks/hooks/useTasks";
import { taskDetailQuery } from "@features/tasks/queries";
import type { Task } from "@shared/types";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { getCachedTask } from "@utils/queryClient";

export const Route = createFileRoute("/code/tasks/$taskId")({
  component: TaskDetailRoute,
  // Synchronous + cache-only: return whatever is already cached (the detail
  // entry seeded by openTask, or the sidebar list) and never await the network.
  // A blocking loader would leave the route pending — and thus un-navigable —
  // whenever the fetch is slow or never resolves (optimistic/cloud-pending
  // tasks the API can't return). The cold-miss fetch + spinner live in the
  // component instead, so navigation always commits instantly.
  loader: ({ context, params }): Task | null => {
    const key = taskDetailQuery(params.taskId).queryKey;
    return (
      context.queryClient.getQueryData<Task>(key) ??
      getCachedTask(params.taskId) ??
      null
    );
  },
});

function TaskDetailRoute() {
  const { taskId } = Route.useParams();
  const loaderTask = Route.useLoaderData();
  const { data: tasks } = useTasks();
  const fromList = tasks?.find((t) => t.id === taskId);

  // Cold deep-link / URL restore: nothing cached. Fetch the single task here so
  // a hang or 404 only affects this view's spinner, never the router.
  const needsFetch = !fromList && !loaderTask;
  const {
    data: fetched,
    isError,
    isSuccess,
  } = useQuery({
    ...taskDetailQuery(taskId),
    enabled: needsFetch,
  });

  // Prefer the live list task (kept fresh by polling + subscriptions).
  const task = fromList ?? loaderTask ?? fetched;

  // Task doesn't exist (deleted, 404, or stale deep link): the cold fetch
  // settled with an error or empty result. Redirect to the new-task screen
  // rather than spin forever — matches the old navigationStore.hydrateTask.
  if (needsFetch && (isError || (isSuccess && !fetched))) {
    return <Navigate replace to="/code" />;
  }

  if (!task) {
    return <RoutePending />;
  }

  return <TaskDetail key={task.id} task={task} />;
}
