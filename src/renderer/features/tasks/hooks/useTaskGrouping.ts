import {
  getTaskGrouping,
  useTaskStore,
} from "@features/tasks/stores/taskStore";
import type { Task } from "@shared/types";

export function useTaskGrouping(
  filteredTasks: Task[],
  _groupBy: unknown,
  _users: unknown,
) {
  const groupBy = useTaskStore((state) => state.groupBy);
  return getTaskGrouping(filteredTasks, groupBy);
}
