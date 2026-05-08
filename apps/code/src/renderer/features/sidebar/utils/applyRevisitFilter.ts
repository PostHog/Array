import type { TaskData } from "../hooks/useSidebarData";

export function applyRevisitFilter(
  tasks: TaskData[],
  showRevisitOnly: boolean,
  revisitTaskIds: Set<string>,
): TaskData[] {
  if (!showRevisitOnly) return tasks;
  return tasks.filter((task) => revisitTaskIds.has(task.id));
}
