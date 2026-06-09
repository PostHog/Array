import type {
  SignalReportStatus,
  SignalReportTask,
  Task,
} from "@posthog/shared/types";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";

type Relationship = SignalReportTask["relationship"];

const DISPLAYED_RELATIONSHIPS: Relationship[] = ["implementation", "research"];

interface ReportTaskData {
  task: Task;
  relationship: Relationship;
  startedAt: string;
}

export function useReportTasks(
  reportId: string,
  reportStatus: SignalReportStatus,
) {
  const isActive =
    reportStatus === "candidate" ||
    reportStatus === "in_progress" ||
    reportStatus === "pending_input";

  return useAuthenticatedQuery<ReportTaskData[]>(
    ["inbox", "report-tasks", reportId],
    async (client) => {
      const reportTasks = await client.getSignalReportTasks(reportId);
      const relevant = reportTasks.filter((rt) =>
        DISPLAYED_RELATIONSHIPS.includes(rt.relationship),
      );
      const tasks = await Promise.all(
        relevant.map(async (rt) => {
          const task = await client.getTask(rt.task_id);
          return {
            task,
            relationship: rt.relationship,
            startedAt: rt.created_at,
          };
        }),
      );
      return tasks.sort(
        (a, b) =>
          DISPLAYED_RELATIONSHIPS.indexOf(a.relationship) -
          DISPLAYED_RELATIONSHIPS.indexOf(b.relationship),
      );
    },
    {
      enabled: !!reportId,
      staleTime: isActive ? 5_000 : 10_000,
      refetchInterval: isActive ? 5_000 : false,
    },
  );
}

export function getTaskPrUrl(task: Task): string | null {
  const prUrl = task.latest_run?.output?.pr_url;
  return typeof prUrl === "string" && prUrl.length > 0 ? prUrl : null;
}
