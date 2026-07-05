import {
  type ArchivedTaskWithDetails,
  mergeArchivedWithTasks,
} from "@posthog/core/archive/archiveListView";
import { useHostTRPC } from "@posthog/host-router/react";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

export interface HomeArchivedTasks {
  items: ArchivedTaskWithDetails[];
  isLoading: boolean;
}

// Window into archived tasks for the Home list view. Reuses the same data
// pipeline as the dedicated ArchivedTasksView (archive.list joined with tasks),
// sorted most-recently-archived first so the Home section shows the latest work.
export function useHomeArchivedTasks(): HomeArchivedTasks {
  const trpc = useHostTRPC();
  const { data: archivedTasks = [], isLoading: isLoadingArchived } = useQuery(
    trpc.archive.list.queryOptions(),
  );
  const { data: tasks = [], isLoading: isLoadingTasks } = useTasks();

  const items = useMemo(() => {
    const merged = mergeArchivedWithTasks(archivedTasks, tasks);
    return [...merged].sort(
      (a, b) =>
        new Date(b.archived.archivedAt).getTime() -
        new Date(a.archived.archivedAt).getTime(),
    );
  }, [archivedTasks, tasks]);

  return { items, isLoading: isLoadingArchived || isLoadingTasks };
}
