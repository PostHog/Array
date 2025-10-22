import type { Task } from "@shared/types";
import { useCallback, useMemo } from "react";
import { getUserDisplayName } from "../../../hooks/useUsers";
import type { GroupByField } from "../../../stores/taskStore";

export function useTaskGrouping(
  filteredTasks: Task[],
  groupBy: GroupByField,
  _users: Array<{
    id: number;
    first_name?: string;
    last_name?: string;
    email: string;
  }>,
) {
  const getGroupKey = useCallback(
    (task: Task): string => {
      switch (groupBy) {
        case "status": {
          // If PR exists, mark as completed, otherwise use latest_run status
          const hasPR = task.latest_run?.output?.pr_url;
          return hasPR ? "completed" : task.latest_run?.status || "Backlog";
        }
        case "creator": {
          if (!task.created_by) return "No Creator";
          return getUserDisplayName(task.created_by);
        }
        case "source":
          return task.origin_product;
        case "repository":
          return task.repository_config?.organization &&
            task.repository_config?.repository
            ? `${task.repository_config.organization}/${task.repository_config.repository}`
            : "No Repository Connected";
        default:
          return "All Tasks";
      }
    },
    [groupBy],
  );

  const groupedTasks = useMemo(() => {
    if (groupBy === "none") {
      return null;
    }

    const groups = new Map<string, Task[]>();
    const taskToGlobalIndex = new Map<string, number>();

    // Build global index mapping
    filteredTasks.forEach((task, index) => {
      taskToGlobalIndex.set(task.id, index);
    });

    for (const task of filteredTasks) {
      const key = getGroupKey(task);
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)?.push(task);
    }

    // Sort groups with specific ordering for status groups
    // Priority: action needed > in progress > completed > backlog
    const statusOrder = [
      "failed",
      "in_progress",
      "started",
      "completed",
      "Backlog",
    ];

    const sortedGroups = Array.from(groups.entries())
      .map(([name, tasks]) => ({
        name,
        tasks,
      }))
      .sort((a, b) => {
        const aIsEmpty = a.name.startsWith("No ");
        const bIsEmpty = b.name.startsWith("No ");

        // Empty groups always go to bottom
        if (aIsEmpty && !bIsEmpty) return 1;
        if (!aIsEmpty && bIsEmpty) return -1;

        // If grouping by status, use status order
        if (groupBy === "status") {
          const aIndex = statusOrder.indexOf(a.name);
          const bIndex = statusOrder.indexOf(b.name);

          if (aIndex !== -1 && bIndex !== -1) {
            return aIndex - bIndex;
          }
          if (aIndex !== -1) return -1;
          if (bIndex !== -1) return 1;
        }

        return a.name.localeCompare(b.name);
      });

    return {
      groups: sortedGroups,
      taskToGlobalIndex,
    };
  }, [filteredTasks, groupBy, getGroupKey]);

  return groupedTasks;
}
