import type { SignalReportTask, Task } from "@posthog/shared/domain-types";

export const REPOSITORY_SOURCE_RELATIONSHIPS: SignalReportTask["relationship"][] =
  ["repo_selection", "research", "implementation"];

export async function resolveReportRepository(
  reportTasks: SignalReportTask[],
  getTask: (taskId: string) => Promise<Task | null>,
): Promise<string | null> {
  for (const relationship of REPOSITORY_SOURCE_RELATIONSHIPS) {
    const reportTask = reportTasks.find(
      (task) => task.relationship === relationship,
    );
    if (!reportTask) {
      continue;
    }
    const task = await getTask(reportTask.task_id);
    if (task?.repository) {
      return task.repository.toLowerCase();
    }
  }
  return null;
}
