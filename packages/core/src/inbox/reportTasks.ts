import type { SignalReportTask, Task } from "@posthog/shared/domain-types";

export type ReportTaskRelationship = SignalReportTask["relationship"];

export const DISPLAYED_RELATIONSHIPS: ReportTaskRelationship[] = [
  "implementation",
  "research",
];

export interface ReportTaskData {
  task: Task;
  relationship: ReportTaskRelationship;
  startedAt: string;
}

/** Keep only report-task relationships that the detail pane renders. */
export function selectDisplayedReportTasks(
  reportTasks: SignalReportTask[],
): SignalReportTask[] {
  return reportTasks.filter((rt) =>
    DISPLAYED_RELATIONSHIPS.includes(rt.relationship),
  );
}

/** Sort report tasks by their relationship's display rank. */
export function sortByRelationship(tasks: ReportTaskData[]): ReportTaskData[] {
  return [...tasks].sort(
    (a, b) =>
      DISPLAYED_RELATIONSHIPS.indexOf(a.relationship) -
      DISPLAYED_RELATIONSHIPS.indexOf(b.relationship),
  );
}

/** Extract the PR url from a task's latest run output, if present. */
export function getTaskPrUrl(task: Task): string | null {
  const output = task.latest_run?.output;
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const prUrl = (output as Record<string, unknown>).pr_url;
    if (typeof prUrl === "string" && prUrl.length > 0) {
      return prUrl;
    }
  }
  return null;
}
