import type { SignalReportTask, Task } from "@posthog/shared/domain-types";

/**
 * Resolve the repository a report's work happened in. Associations are
 * unlabelled — the repository is simply the first one any associated task
 * carries, walking oldest-first (repo selection / research precede
 * implementation).
 */
export async function resolveReportRepository(
  reportTasks: SignalReportTask[],
  getTask: (taskId: string) => Promise<Task | null>,
): Promise<string | null> {
  const ordered = [...reportTasks].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  for (const reportTask of ordered) {
    const task = await getTask(reportTask.task_id);
    if (task?.repository) {
      return task.repository.toLowerCase();
    }
  }
  return null;
}
