import { useTRPC } from "@renderer/trpc";
import type { PrSnapshot, TaskPrRef } from "@shared/types/pr-snapshot";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { usePrSnapshotStore } from "../stores/prSnapshotStore";

/**
 * Resolves PR/CI snapshots for the given tasks as a `Map` keyed by task id. The
 * query registers the tasks for background polling and seeds the first paint;
 * the subscription store (features/home/subscriptions.ts) wins after that. Tasks
 * without a PR are simply absent from the map.
 */
export function usePrSnapshots(refs: TaskPrRef[]): Map<string, PrSnapshot> {
  const trpc = useTRPC();

  // Dedupe + sort for a stable query key. `refs` is already memoized upstream,
  // and TanStack serialises the input, so an equal-content list never refetches.
  const tasks = useMemo(() => {
    const byId = new Map<string, TaskPrRef>();
    for (const ref of refs) byId.set(ref.taskId, ref);
    return [...byId.values()].sort((a, b) => a.taskId.localeCompare(b.taskId));
  }, [refs]);

  const query = useQuery(
    trpc.prSnapshot.getSnapshots.queryOptions(
      { tasks },
      { enabled: tasks.length > 0, staleTime: 60_000 },
    ),
  );

  const byTaskId = usePrSnapshotStore((s) => s.byTaskId);

  return useMemo(() => {
    const map = new Map<string, PrSnapshot>();
    for (const { taskId, snapshot } of query.data ?? [])
      map.set(taskId, snapshot);
    // Subscription cache is fresher than the initial query — let it win.
    for (const ref of tasks) {
      const snapshot = byTaskId[ref.taskId];
      if (snapshot) map.set(ref.taskId, snapshot);
    }
    return map;
  }, [query.data, byTaskId, tasks]);
}
