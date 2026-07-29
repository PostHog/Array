import { inboxReportKeys } from "@posthog/core/inbox/inboxQuery";
import { reportChartQueryHash } from "@posthog/core/inbox/reportCharts";
import type { ReportChart } from "@posthog/shared/types";
import { useAuthStateValue } from "@posthog/ui/features/auth/store";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";

/** Chart results are a snapshot of evidence, not a live metric — refetch rarely. */
const STALE_TIME_MS = 5 * 60 * 1000;

/**
 * Runs a report chart's query and hands back the raw `/query/` response for a
 * shaper in `@posthog/core/inbox/reportCharts` to interpret. The chart's kind was
 * validated when the report was normalized, so nothing unexpected reaches the
 * query endpoint from here.
 */
export function useReportChartData(reportId: string, chart: ReportChart) {
  const projectId = useAuthStateValue((state) => state.currentProjectId);

  return useAuthenticatedQuery<Record<string, unknown>>(
    inboxReportKeys.chart(
      projectId,
      reportId,
      chart.chart_id,
      reportChartQueryHash(chart.query),
    ),
    (client) => client.runInsightQuery(chart.query),
    { enabled: !!projectId, staleTime: STALE_TIME_MS, retry: false },
  );
}
