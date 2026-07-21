import type { Task } from "@posthog/shared/domain-types";
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
import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/code/tasks/$taskId")({
  component: TaskDetailRoute,
  pendingComponent: TaskDetailSkeleton,
  // Cache-only: return whatever is already cached (the detail entry seeded by
  // openTask, or the sidebar list) and never await the network. A
  // network-blocked loader would leave the route pending — and thus
  // un-navigable — whenever the fetch is slow or never resolves
  // (optimistic/cloud-pending tasks the API can't return). The cold-miss
  // fetch + skeleton live in the component instead. The single-frame yield
  // lets the pending skeleton paint before TaskDetail's heavy mount (chat
  // thread, terminal) blocks the main thread.
  loader: async ({ params }): Promise<Task | null> => {
    const task =
      getCachedTaskDetail(params.taskId) ??
      getCachedTask(params.taskId) ??
      null;
    await yieldToPaint();
    return task;
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
    return <TaskDetailSkeleton />;
  }

  return <TaskDetail task={task} />;
}
