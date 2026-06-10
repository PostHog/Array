import { seedInboxReportDetailCache } from "@posthog/core/inbox/inboxQuery";
import { useHostTRPC } from "@posthog/host-router/react";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useAuthStateValue } from "@posthog/ui/features/auth/store";
import { AUTH_SCOPED_QUERY_META } from "@posthog/ui/features/auth/useCurrentUser";
import { reportKeys } from "@posthog/ui/features/inbox/hooks/useInboxReports";
import { useInboxSignalsFilterStore } from "@posthog/ui/features/inbox/stores/inboxSignalsFilterStore";
import {
  navigateToInboxPullRequestDetail,
  navigateToInboxReportDetail,
} from "@posthog/ui/router/navigationBridge";
import { logger } from "@posthog/ui/shell/logger";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";

const log = logger.scope("inbox-deep-link");

/**
 * Hook that subscribes to inbox report deep link events (`<scheme>://inbox/{reportId}`,
 * e.g. `posthog-code://…` in production and `posthog-code-dev://…` in local dev)
 * and opens the report in the inbox view.
 *
 * Behavior on link arrival:
 * 1. Fetch the report by id directly, bypassing the paginated list, and seed
 *    the TanStack Query cache so the detail pane fallback reuses it.
 *    - On 404/403 (wrong team / deleted / suppressed): toast "Report not found
 *      in the current team" and leave the current view untouched.
 *    - On transient failure: toast a generic error and leave state untouched.
 * 2. Only on success: reset inbox-local filters (so the report isn't hidden)
 *    and navigate directly to the report's detail view. The tab is picked from
 *    the report itself – Pulls if it has an implementation PR, otherwise
 *    Reports – so the user lands on the right surface regardless of which tab
 *    was last selected. Runs reports also surface in the report detail view,
 *    where the run logs are visible.
 */
export function useInboxDeepLink() {
  const trpcReact = useHostTRPC();
  const queryClient = useQueryClient();
  const client = useOptionalAuthenticatedClient();
  const isAuthenticated = useAuthStateValue(
    (s) => s.status === "authenticated",
  );

  const resetFilters = useInboxSignalsFilterStore((s) => s.resetFilters);

  const pendingDeepLink = useQuery(
    trpcReact.deepLink.getPendingReportLink.queryOptions(undefined, {
      enabled: isAuthenticated && !!client,
      // Drain once per session – the main process clears its pending entry on read.
      staleTime: Number.POSITIVE_INFINITY,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }),
  );

  const openReport = useCallback(
    async (reportId: string) => {
      if (!client) {
        log.warn("Ignoring inbox deep link – not authenticated");
        return;
      }

      log.info(`Opening report from deep link: ${reportId}`);

      try {
        const report = await queryClient.fetchQuery({
          queryKey: reportKeys.detail(reportId),
          queryFn: () => client.getSignalReport(reportId),
          meta: AUTH_SCOPED_QUERY_META,
        });

        if (!report) {
          log.warn(`Report not found or not accessible: ${reportId}`);
          toast.error("Report not found in the current team");
          return;
        }

        resetFilters();
        seedInboxReportDetailCache(queryClient, report);
        if (report.implementation_pr_url) {
          navigateToInboxPullRequestDetail(report.id);
        } else {
          navigateToInboxReportDetail(report.id);
        }
        log.info(`Successfully opened report from deep link: ${report.id}`);
      } catch (error) {
        log.error("Unexpected error opening report from deep link:", error);
        toast.error("Failed to open report");
      }
    },
    [client, queryClient, resetFilters],
  );

  useEffect(() => {
    if (pendingDeepLink.data?.reportId) {
      void openReport(pendingDeepLink.data.reportId);
    }
  }, [pendingDeepLink.data, openReport]);

  useSubscription(
    trpcReact.deepLink.onOpenReport.subscriptionOptions(undefined, {
      onData: (data) => {
        if (data?.reportId) void openReport(data.reportId);
      },
    }),
  );
}
