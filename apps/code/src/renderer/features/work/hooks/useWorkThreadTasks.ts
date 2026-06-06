import { useTasks } from "@features/tasks/hooks/useTasks";
import type { Task } from "@shared/types";
import { useMemo } from "react";
import { useWorkThreadsStore } from "../stores/workThreadsStore";

/**
 * Work-mode thread list — the tasks the current user created from Work mode.
 *
 * Membership is tracked locally in `workThreadsStore` (set via `addThread` when
 * a task is created from `WorkHomePrompt` / `WorkSampleProjects`). This is a
 * single-machine list; there is no cross-user thread sharing.
 *
 * FOLLOW-UP: when `Task.collaborators` (M2M + endpoint) ships, derive
 * membership from the server and drop this local store.
 */
export function useWorkThreadTasks() {
  const query = useTasks({ showAllUsers: true });
  const localThreadIds = useWorkThreadsStore((s) => s.taskIds);

  const sorted = useMemo<Task[]>(() => {
    const tasks = query.data ?? [];
    const localIdSet = new Set(localThreadIds);
    return tasks
      .filter((t) => localIdSet.has(t.id))
      .sort((a, b) => {
        const ta = new Date(a.created_at).getTime();
        const tb = new Date(b.created_at).getTime();
        return tb - ta;
      });
  }, [query.data, localThreadIds]);

  return { ...query, data: sorted };
}
