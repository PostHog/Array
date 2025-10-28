import { getUserDisplayName } from "@hooks/useUsers";
import type { Task } from "@shared/types";
import {
  type GroupByField,
  TASK_STATUS_ORDER,
  type TaskGroupingResult,
} from "../stores/taskStore.types";

export function getTaskGrouping(
  filteredTasks: Task[],
  groupBy: GroupByField,
): TaskGroupingResult | null {
  if (groupBy === "none") {
    return null;
  }

  const getGroupKey = (task: Task): string => {
    switch (groupBy) {
      case "status": {
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
  };

  const groups = new Map<string, Task[]>();
  const taskToGlobalIndex = new Map<string, number>();

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

  const sortedGroups = Array.from(groups.entries())
    .map(([name, tasks]) => ({
      name,
      tasks,
    }))
    .sort((a, b) => {
      if (groupBy === "status") {
        const aIndex = TASK_STATUS_ORDER.indexOf(a.name.toLowerCase());
        const bIndex = TASK_STATUS_ORDER.indexOf(b.name.toLowerCase());

        if (aIndex !== -1 && bIndex !== -1) {
          return aIndex - bIndex;
        }
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
      }

      const aIsEmpty = a.name.startsWith("No ");
      const bIsEmpty = b.name.startsWith("No ");

      if (aIsEmpty && !bIsEmpty) return 1;
      if (!aIsEmpty && bIsEmpty) return -1;

      return a.name.localeCompare(b.name);
    });

  return {
    groups: sortedGroups,
    taskToGlobalIndex,
  };
}
