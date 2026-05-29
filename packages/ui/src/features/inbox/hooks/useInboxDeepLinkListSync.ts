import type { SignalReport } from "@posthog/shared/domain-types";
import { useEffect, useMemo, useRef } from "react";
import { useInboxReportSelectionStore } from "../inboxReportSelectionStore";
import { INBOX_REFETCH_INTERVAL_MS } from "../utils/inboxConstants";
import { useInboxReportById } from "./useInboxReports";

/**
 * Keeps inbox list selection in sync when the selected report is not on the
 * current paginated/filtered list (e.g. opened via an inbox deep link):
 * by-id fetch for the detail pane, selection pruning as the list changes, and
 * scroll-into-view when the row later appears in `reports`.
 */
export function useInboxDeepLinkListSync(options: {
  reports: SignalReport[];
  inboxPollingActive: boolean;
}): { selectedReport: SignalReport | null } {
  const { reports, inboxPollingActive } = options;

  const selectedReportIds = useInboxReportSelectionStore(
    (s) => s.selectedReportIds,
  );
  const pruneSelection = useInboxReportSelectionStore((s) => s.pruneSelection);

  const singleSelectedId =
    selectedReportIds.length === 1 ? selectedReportIds[0] : null;
  const selectedReportFromList = useMemo(() => {
    if (!singleSelectedId) return null;
    return reports.find((r) => r.id === singleSelectedId) ?? null;
  }, [reports, singleSelectedId]);
  const needsByIdFallback = !!singleSelectedId && !selectedReportFromList;
  const { data: byIdReport, isError: byIdError } = useInboxReportById(
    needsByIdFallback ? singleSelectedId : null,
    {
      refetchInterval: inboxPollingActive ? INBOX_REFETCH_INTERVAL_MS : false,
      refetchIntervalInBackground: false,
      staleTime: inboxPollingActive ? INBOX_REFETCH_INTERVAL_MS : 12_000,
    },
  );

  // Prune selection when visible reports change (e.g. filter/search).
  // Preserve off-list selections that are still loading or resolved via
  // the by-id fallback; let prune clear them on confirmed null or on error.
  useEffect(() => {
    const visibleIds = reports.map((report) => report.id);
    if (
      singleSelectedId &&
      !reports.some((r) => r.id === singleSelectedId) &&
      !byIdError &&
      byIdReport !== null
    ) {
      visibleIds.push(singleSelectedId);
    }
    pruneSelection(visibleIds);
  }, [reports, pruneSelection, singleSelectedId, byIdReport, byIdError]);

  // Scroll once per selection change; refetches must not snap the list back.
  const autoScrolledIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!singleSelectedId) {
      autoScrolledIdRef.current = null;
      return;
    }
    if (autoScrolledIdRef.current === singleSelectedId) return;
    if (!reports.some((r) => r.id === singleSelectedId)) return;

    document
      .querySelector(`[data-report-id="${CSS.escape(singleSelectedId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
    autoScrolledIdRef.current = singleSelectedId;
  }, [singleSelectedId, reports]);

  const selectedReport = useMemo(() => {
    if (selectedReportIds.length !== 1) return null;
    return selectedReportFromList ?? byIdReport ?? null;
  }, [selectedReportIds, selectedReportFromList, byIdReport]);

  return { selectedReport };
}
