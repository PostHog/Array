import type {
  HomeSnapshot,
  HomeWorkstream,
  HomeWorkstreamTask,
} from "@posthog/core/home/schemas";
import type { Task } from "@posthog/shared/domain-types";

// A freshly-created cloud task hasn't been picked up by the server-side workstream rebuild yet,
// so we splice a provisional row in by hand to give the quick action immediate feedback. The
// next snapshot poll reconciles it with the authoritative server state.
export function workstreamTaskFromTask(
  task: Task,
  quickAction?: string,
): HomeWorkstreamTask {
  return {
    id: task.id,
    title: task.title || "New task",
    status: task.latest_run?.status ?? "queued",
    isGenerating: false,
    needsPermission: false,
    quickAction: quickAction ?? null,
  };
}

export function insertOptimisticTask(
  snapshot: HomeSnapshot,
  workstreamId: string,
  task: Task,
  quickAction?: string,
): HomeSnapshot {
  const wsTask = workstreamTaskFromTask(task, quickAction);

  const addToBucket = (bucket: HomeWorkstream[]): HomeWorkstream[] =>
    bucket.map((ws) =>
      ws.id === workstreamId && !ws.tasks.some((t) => t.id === task.id)
        ? { ...ws, tasks: [wsTask, ...ws.tasks] }
        : ws,
    );

  return {
    ...snapshot,
    needsAttention: addToBucket(snapshot.needsAttention),
    inProgress: addToBucket(snapshot.inProgress),
  };
}
