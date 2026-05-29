import { useSessionForTask } from "../sessions/useSession";
import { useTasks } from "../tasks/useTasks";
import { resolveCloudPrUrl } from "./cloudPrUrl";

export { resolveCloudPrUrl };

/** Hook wrapper for components that don't already have the task/session. */
export function useCloudPrUrl(taskId: string): string | null {
  const { data: tasks = [] } = useTasks();
  const task = tasks.find((t) => t.id === taskId);
  const session = useSessionForTask(taskId);
  return resolveCloudPrUrl(task, session);
}
