import { isContentlessTask, type Task } from "@posthog/shared/domain-types";

export type TaskActivitySortMode = "created" | "updated";

export function taskActivityTimestamp(
  task: Pick<Task, "created_at" | "updated_at" | "latest_run">,
  sortMode: TaskActivitySortMode,
): number {
  if (sortMode === "created") {
    return new Date(task.created_at).getTime();
  }

  const runUpdatedAt = task.latest_run?.updated_at;
  return Math.max(
    runUpdatedAt ? new Date(runUpdatedAt).getTime() : 0,
    new Date(task.updated_at ?? task.created_at).getTime(),
  );
}

export function filterAndSortTasks(
  tasks: readonly Task[],
  sortMode: TaskActivitySortMode,
  showInternal: boolean,
  filter: string,
): Task[] {
  const normalizedFilter = filter.toLowerCase();

  return tasks
    .filter((task) => !isContentlessTask(task))
    .filter((task) =>
      showInternal ? task.internal === true : task.internal !== true,
    )
    .filter(
      (task) =>
        !normalizedFilter ||
        task.title.toLowerCase().includes(normalizedFilter) ||
        task.slug.toLowerCase().includes(normalizedFilter) ||
        task.description?.toLowerCase().includes(normalizedFilter),
    )
    .sort(
      (firstTask, secondTask) =>
        taskActivityTimestamp(secondTask, sortMode) -
        taskActivityTimestamp(firstTask, sortMode),
    );
}
