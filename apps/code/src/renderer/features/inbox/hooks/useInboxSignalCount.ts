import { useInboxReports } from "@features/inbox/hooks/useInboxReports";
import { isReportUpForReview } from "@features/inbox/utils/filterReports";
import {
  INBOX_PIPELINE_STATUS_FILTER,
  INBOX_REFETCH_INTERVAL_MS,
} from "@features/inbox/utils/inboxConstants";
import { useRendererWindowFocusStore } from "@stores/rendererWindowFocusStore";

/**
 * Count of actionable inbox reports assigned to the user. Uses the same query
 * args as the sidebar inbox probe, so they share one cache (no extra polling).
 */
export function useInboxSignalCount(): number {
  const polling = useRendererWindowFocusStore((s) => s.focused);
  const { data } = useInboxReports(
    { status: INBOX_PIPELINE_STATUS_FILTER },
    {
      refetchInterval: polling ? INBOX_REFETCH_INTERVAL_MS : false,
      refetchIntervalInBackground: false,
      staleTime: polling ? INBOX_REFETCH_INTERVAL_MS : 15_000,
    },
  );
  return (data?.results ?? []).filter(isReportUpForReview).length;
}
