import { buildInboxViewedProperties } from "@posthog/core/inbox/engagement";
import { INBOX_SCOPE_FOR_YOU } from "@posthog/core/inbox/reportMembership";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { useInboxAllReports } from "@posthog/ui/features/inbox/hooks/useInboxAllReports";
import { useInboxSignalsFilterStore } from "@posthog/ui/features/inbox/stores/inboxSignalsFilterStore";
import { track } from "@posthog/ui/shell/analytics";
import { useEffect, useRef } from "react";

/**
 * Fires `INBOX_VIEWED` once per inbox visit, after the report list settles,
 * with the counts the user sees on load (tab badges, total, ready, and the
 * priority/actionability breakdown of the visible reports).
 *
 * Restores the event dropped when Inbox 2.0 deleted `InboxSignalsTab`. Mounted
 * from `InboxView`, so it fires once per visit and survives tab switches (the
 * shell stays mounted while the `<Outlet />` swaps tab bodies).
 */
export function useTrackInboxViewed(): void {
  const { scopedReports, totalCount, counts, scope, isLoading } =
    useInboxAllReports();
  const sourceProductFilter = useInboxSignalsFilterStore(
    (s) => s.sourceProductFilter,
  );
  const priorityFilter = useInboxSignalsFilterStore((s) => s.priorityFilter);
  const searchQuery = useInboxSignalsFilterStore((s) => s.searchQuery);

  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    if (isLoading) return;
    firedRef.current = true;
    track(
      ANALYTICS_EVENTS.INBOX_VIEWED,
      buildInboxViewedProperties({
        visibleReports: scopedReports,
        totalCount,
        tabCounts: counts,
        filters: {
          sourceProductFilter,
          priorityFilter,
          searchQuery,
          isDefaultScope: scope === INBOX_SCOPE_FOR_YOU,
        },
      }),
    );
  }, [
    isLoading,
    scopedReports,
    totalCount,
    counts,
    scope,
    sourceProductFilter,
    priorityFilter,
    searchQuery,
  ]);
}
