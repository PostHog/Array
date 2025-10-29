import { useTaskStore } from "@features/tasks/stores/taskStore";
import { getTaskGrouping } from "@features/tasks/utils/taskGrouping";
import type { Task } from "@shared/types";

export function useTaskGrouping(
  filteredTasks: Task[],
  _groupBy: unknown,
  _users: unknown,
) {
  const groupBy = useTaskStore((state) => state.groupBy);
  return getTaskGrouping(filteredTasks, groupBy);
}
