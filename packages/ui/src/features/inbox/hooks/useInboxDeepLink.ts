import { useHostTRPCClient } from "@posthog/host-router/react";
import { navigateToInbox } from "@posthog/ui/router/navigationBridge";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { logger } from "../../../shell/logger";
import { useOptionalAuthenticatedClient } from "../../auth/authClient";
import { useAuthStateValue } from "../../auth/store";
import { AUTH_SCOPED_QUERY_META } from "../../auth/useCurrentUser";
import { useInboxReportSelectionStore } from "../inboxReportSelectionStore";
import { useInboxSignalsFilterStore } from "../inboxSignalsFilterStore";
import { setPendingInboxOpenMethod } from "../utils/pendingInboxOpenMethod";
import { reportKeys } from "./useInboxReports";

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
 * 2. Only on success: reset inbox-local filters (so the report isn't hidden),
 *    navigate to the inbox view, and select the report id.
 */
export function useInboxDeepLink() {
  const hostClient = useHostTRPCClient();
  const queryClient = useQueryClient();
  const client = useOptionalAuthenticatedClient();
  const isAuthenticated = useAuthStateValue(
    (s) => s.status === "authenticated",
  );
  const pendingDrainedRef = useRef(false);

  const setSelectedReportIds = useInboxReportSelectionStore(
    (s) => s.setSelectedReportIds,
  );
  const resetFilters = useInboxSignalsFilterStore((s) => s.resetFilters);

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
        navigateToInbox();
        setPendingInboxOpenMethod("deeplink");
        setSelectedReportIds([report.id]);
        log.info(`Successfully opened report from deep link: ${report.id}`);
      } catch (error) {
        log.error("Unexpected error opening report from deep link:", error);
        toast.error("Failed to open report");
      }
    },
    [client, queryClient, resetFilters, setSelectedReportIds],
  );

  useEffect(() => {
    if (!isAuthenticated) {
      pendingDrainedRef.current = false;
      return;
    }
    if (!client || pendingDrainedRef.current) return;

    pendingDrainedRef.current = true;
    void (async () => {
      try {
        const pending = await hostClient.deepLink.getPendingReportLink.query();
        if (pending) await openReport(pending.reportId);
      } catch (error) {
        log.error("Failed to check for pending inbox deep link:", error);
      }
    })();
  }, [isAuthenticated, client, openReport, hostClient]);

  useEffect(() => {
    const subscription = hostClient.deepLink.onOpenReport.subscribe(undefined, {
      onData: (data) => {
        if (data?.reportId) void openReport(data.reportId);
      },
    });
    return () => subscription.unsubscribe();
  }, [hostClient, openReport]);
}
