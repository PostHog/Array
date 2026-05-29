import {
  type ReportTaskData,
  selectDisplayedReportTasks,
  sortByRelationship,
} from "@posthog/core/inbox/reportTasks";
import type { SignalReportStatus, Task } from "@posthog/shared/domain-types";
import { useAuthenticatedQuery } from "../../../hooks/useAuthenticatedQuery";

export { getTaskPrUrl } from "@posthog/core/inbox/reportTasks";

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
      const relevant = selectDisplayedReportTasks(reportTasks);
      const tasks = await Promise.all(
        relevant.map(async (rt) => {
          const task = (await client.getTask(rt.task_id)) as unknown as Task;
          return {
            task,
            relationship: rt.relationship,
            startedAt: rt.created_at,
          };
        }),
      );
      return sortByRelationship(tasks);
    },
    {
      enabled: !!reportId,
      staleTime: isActive ? 5_000 : 10_000,
      refetchInterval: isActive ? 5_000 : false,
    },
  );
}
