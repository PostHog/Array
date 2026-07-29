import { isTerminalStatus, type Task } from "@posthog/shared/domain-types";

export function isTaskRunning(task: Pick<Task, "latest_run">): boolean {
  const status = task.latest_run?.status;
  return status !== undefined && !isTerminalStatus(status);
}
