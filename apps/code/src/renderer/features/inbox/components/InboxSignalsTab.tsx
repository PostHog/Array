import { useOptionalAuthenticatedClient } from "@features/auth/hooks/authClient";
import { useCurrentUser } from "@features/auth/hooks/authQueries";
import {
  SelectReportPane,
  SkeletonBackdrop,
  WarmingUpPane,
} from "@features/inbox/components/InboxEmptyStates";
import { InboxSetupPane } from "@features/inbox/components/InboxSetupPane";
import { InboxSourcesDialog } from "@features/inbox/components/InboxSourcesDialog";
import {
  inboxBulkSnoozeDisabledReason,
  inboxBulkSuppressDisabledReason,
  useInboxBulkActions,
} from "@features/inbox/hooks/useInboxBulkActions";
import { useInboxDeepLinkListSync } from "@features/inbox/hooks/useInboxDeepLinkListSync";
import { useInboxEngagementTracker } from "@features/inbox/hooks/useInboxEngagementTracker";
import {
  useInboxAvailableSuggestedReviewers,
  useInboxReportsInfinite,
  useInboxSignalProcessingState,
} from "@features/inbox/hooks/useInboxReports";
import { useSeedSuggestedReviewerFilter } from "@features/inbox/hooks/useSeedSuggestedReviewerFilter";
import { useSignalSourceConfigs } from "@features/inbox/hooks/useSignalSourceConfigs";
import { useInboxReportSelectionStore } from "@features/inbox/stores/inboxReportSelectionStore";
import { useInboxSignalsFilterStore } from "@features/inbox/stores/inboxSignalsFilterStore";
import { useInboxSignalsSidebarStore } from "@features/inbox/stores/inboxSignalsSidebarStore";
import { useInboxSourcesDialogStore } from "@features/inbox/stores/inboxSourcesDialogStore";
import {
  buildPriorityFilterParam,
  buildSignalReportListOrdering,
  buildStatusFilterParam,
  buildSuggestedReviewerFilterParam,
  filterReportsBySearch,
  isReportUpForReview,
} from "@features/inbox/utils/filterReports";
import { INBOX_REFETCH_INTERVAL_MS } from "@features/inbox/utils/inboxConstants";
import { setPendingInboxOpenMethod } from "@features/inbox/utils/pendingInboxOpenMethod";
import { useAppView } from "@hooks/useAppView";
import { useAuthenticatedQuery } from "@hooks/useAuthenticatedQuery";
import {
  useIntegrations,
  useRepositoryIntegration,
} from "@hooks/useIntegrations";
import { Box, Flex, ScrollArea } from "@radix-ui/themes";
import { isDismissalReasonSnooze } from "@shared/dismissalReasons";
import type { SignalReport, SignalReportsQueryParams } from "@shared/types";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { useRendererWindowFocusStore } from "@stores/rendererWindowFocusStore";
import { track } from "@utils/analytics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DismissReportDialog,
  type DismissReportDialogResult,
} from "./DismissReportDialog";
import { MultiSelectStack } from "./detail/MultiSelectStack";
import { ReportDetailPane } from "./detail/ReportDetailPane";
import { GitHubConnectionBanner } from "./list/GitHubConnectionBanner";
import { ReportListPane } from "./list/ReportListPane";
import { SignalsToolbar } from "./list/SignalsToolbar";

// ── Main component ──────────────────────────────────────────────────────────

export function InboxSignalsTab() {
  // ── Filter / sort store ─────────────────────────────────────────────────
  const sortField = useInboxSignalsFilterStore((s) => s.sortField);
  const sortDirection = useInboxSignalsFilterStore((s) => s.sortDirection);
  const searchQuery = useInboxSignalsFilterStore((s) => s.searchQuery);
  const statusFilter = useInboxSignalsFilterStore((s) => s.statusFilter);
  const sourceProductFilter = useInboxSignalsFilterStore(
    (s) => s.sourceProductFilter,
  );
  const suggestedReviewerFilter = useInboxSignalsFilterStore(
    (s) => s.suggestedReviewerFilter,
  );
  const priorityFilter = useInboxSignalsFilterStore((s) => s.priorityFilter);
  // ── Current user (seeds reviewer filter on first inbox visit) ───────────
  const authClient = useOptionalAuthenticatedClient();
  const { data: currentUser } = useCurrentUser({
    client: authClient,
    enabled: !!authClient,
  });
  // Gates the seed below: backend filters reports by GitHub login, not UUID.
  const { data: githubLogin } = useAuthenticatedQuery(
    ["github_login"],
    (client) => client.getGithubLogin(),
    { staleTime: 5 * 60 * 1000 },
  );
  useSeedSuggestedReviewerFilter({
    currentUserUuid: currentUser?.uuid,
    githubLogin,
  });

  // ── GitHub integration ───────────────────────────────────────────────
  const { hasGithubIntegration } = useRepositoryIntegration();

  // ── Signal source configs ───────────────────────────────────────────────
  const { data: signalSourceConfigs, isPending: signalSourceConfigsPending } =
    useSignalSourceConfigs();
  const { isPending: integrationsPending, data: integrationsData } =
    useIntegrations();
  /** Matches store-backed `hasGithubIntegration`, but uses query data so there is no lag behind the `useIntegrations` → Zustand sync effect. */
  const hasGithubIntegrationFromQuery = useMemo(
    () => integrationsData?.some((i) => i.kind === "github") ?? false,
    [integrationsData],
  );
  const hasSignalSources = signalSourceConfigs?.some((c) => c.enabled) ?? false;
  const enabledProducts = useMemo(() => {
    const seen = new Set<string>();
    return (signalSourceConfigs ?? [])
      .filter(
        (c) =>
          c.enabled &&
          !seen.has(c.source_product) &&
          seen.add(c.source_product),
      )
      .map((c) => c.source_product);
  }, [signalSourceConfigs]);

  // ── Sources dialog ──────────────────────────────────────────────────────
  const sourcesDialogOpen = useInboxSourcesDialogStore((s) => s.open);
  const setSourcesDialogOpen = useInboxSourcesDialogStore((s) => s.setOpen);

  // ── Polling control ─────────────────────────────────────────────────────
  const windowFocused = useRendererWindowFocusStore((s) => s.focused);
  const isInboxView = useAppView().type === "inbox";
  const inboxPollingActive = windowFocused && isInboxView;

  const inboxSourcesPrerequisitesLoaded =
    !integrationsPending && !signalSourceConfigsPending;

  // ── Data fetching ───────────────────────────────────────────────────────
  useInboxAvailableSuggestedReviewers({
    enabled: isInboxView,
  });

  const inboxQueryParams = useMemo(
    (): SignalReportsQueryParams => ({
      status: buildStatusFilterParam(statusFilter),
      ordering: buildSignalReportListOrdering(sortField, sortDirection),
      source_product:
        sourceProductFilter.length > 0
          ? sourceProductFilter.join(",")
          : undefined,
      suggested_reviewers:
        suggestedReviewerFilter.length > 0
          ? buildSuggestedReviewerFilterParam(suggestedReviewerFilter)
          : undefined,
      priority: buildPriorityFilterParam(priorityFilter),
    }),
    [
      statusFilter,
      sortField,
      sortDirection,
      sourceProductFilter,
      suggestedReviewerFilter,
      priorityFilter,
    ],
  );

  const {
    allReports,
    totalCount,
    isLoading,
    isFetching,
    error,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useInboxReportsInfinite(inboxQueryParams, {
    refetchInterval: inboxPollingActive ? INBOX_REFETCH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    staleTime: inboxPollingActive ? INBOX_REFETCH_INTERVAL_MS : 12_000,
  });

  const didAutoOpenSourcesDialogThisInboxVisitRef = useRef(false);

  useEffect(() => {
    if (!isInboxView) {
      didAutoOpenSourcesDialogThisInboxVisitRef.current = false;
      return;
    }
    if (!inboxSourcesPrerequisitesLoaded || isLoading || error != null) {
      return;
    }
    if (totalCount <= 0) {
      return;
    }
    const needsSourcesOrGithubSetup =
      !hasSignalSources || !hasGithubIntegrationFromQuery;
    if (!needsSourcesOrGithubSetup) {
      return;
    }
    if (didAutoOpenSourcesDialogThisInboxVisitRef.current) {
      return;
    }
    didAutoOpenSourcesDialogThisInboxVisitRef.current = true;
    setSourcesDialogOpen(true);
  }, [
    isInboxView,
    inboxSourcesPrerequisitesLoaded,
    isLoading,
    error,
    totalCount,
    hasSignalSources,
    hasGithubIntegrationFromQuery,
    setSourcesDialogOpen,
  ]);

  const reports = useMemo(
    () => filterReportsBySearch(allReports, searchQuery),
    [allReports, searchQuery],
  );

  const { data: signalProcessingState } = useInboxSignalProcessingState({
    enabled: isInboxView,
    refetchInterval: inboxPollingActive ? INBOX_REFETCH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    staleTime: inboxPollingActive ? INBOX_REFETCH_INTERVAL_MS : 12_000,
  });

  const readyCount = useMemo(
    () => allReports.filter(isReportUpForReview).length,
    [allReports],
  );
  const processingCount = useMemo(
    () => allReports.filter((r) => r.status !== "ready").length,
    [allReports],
  );

  // ── Selection state (unified — store is single source of truth) ─────────
  const selectedReportIds = useInboxReportSelectionStore(
    (s) => s.selectedReportIds,
  );
  const setSelectedReportIds = useInboxReportSelectionStore(
    (s) => s.setSelectedReportIds,
  );
  const toggleReportSelection = useInboxReportSelectionStore(
    (s) => s.toggleReportSelection,
  );
  const selectRange = useInboxReportSelectionStore((s) => s.selectRange);
  const selectExactRange = useInboxReportSelectionStore(
    (s) => s.selectExactRange,
  );
  const clearSelection = useInboxReportSelectionStore((s) => s.clearSelection);

  const [dismissReport, setDismissReport] = useState<SignalReport | null>(null);
  const [dismissDialogSurface, setDismissDialogSurface] = useState<
    "toolbar" | "detail_pane"
  >("detail_pane");

  const dismissTargetId = dismissReport?.id ?? null;
  const dismissBulkActions = useInboxBulkActions(allReports, dismissTargetId);

  const handleDismissDialogOpenChange = useCallback((open: boolean) => {
    if (!open) setDismissReport(null);
  }, []);

  const { selectedReport } = useInboxDeepLinkListSync({
    reports,
    inboxPollingActive,
  });

  const tracker = useInboxEngagementTracker({
    currentReportId:
      selectedReportIds.length === 1 ? selectedReportIds[0] : null,
    currentReport: selectedReport,
    reports,
    isInboxView,
  });

  const handleDismissConfirm = useCallback(
    async (result: DismissReportDialogResult) => {
      if (dismissTargetId == null) return;
      // Snapshot the visible list + report shape before the mutation — by the time it
      // resolves the inbox query has been invalidated and the report we just dismissed
      // is gone, so an after-the-fact lookup would record rank: -1 + a smaller list_size.
      const preMutationRank = reports.findIndex(
        (r) => r.id === dismissTargetId,
      );
      const preMutationListSize = reports.length;
      const target = allReports.find((r) => r.id === dismissTargetId);
      const ageMs = target
        ? Date.now() - new Date(target.created_at).getTime()
        : Number.NaN;
      const reportAgeHours = Number.isFinite(ageMs)
        ? Math.max(0, Math.round((ageMs / 3_600_000) * 10) / 10)
        : 0;

      const isSnooze = isDismissalReasonSnooze(result.reason);
      const ok = isSnooze
        ? await dismissBulkActions.snoozeSelected()
        : await dismissBulkActions.suppressSelected(result);
      if (ok) {
        tracker.signalAction({
          report_id: dismissTargetId,
          report_title: target?.title ?? null,
          report_age_hours: reportAgeHours,
          action_type: isSnooze ? "snooze" : "dismiss",
          surface: dismissDialogSurface,
          is_bulk: false,
          bulk_size: 1,
          rank: preMutationRank,
          list_size: preMutationListSize,
          // Snapshot priority/actionability from the pre-mutation target —
          // by the time this fires the report has been removed from `reports`.
          priority: target?.priority ?? null,
          actionability: target?.actionability ?? null,
          ...(isSnooze
            ? {}
            : {
                dismissal_reason: result.reason,
                ...(result.note.trim()
                  ? { dismissal_note: result.note.slice(0, 1000) }
                  : {}),
              }),
        });
        setDismissReport(null);
      }
    },
    [
      dismissBulkActions,
      dismissTargetId,
      dismissDialogSurface,
      tracker,
      allReports,
      reports,
    ],
  );

  const openDismissDialogFromToolbar = useCallback(() => {
    if (selectedReportIds.length !== 1) return;
    const id = selectedReportIds[0];
    const report = allReports.find((r) => r.id === id);
    if (report) {
      setDismissDialogSurface("toolbar");
      setDismissReport(report);
    }
  }, [selectedReportIds, allReports]);

  const openDismissDialogFromDetailPane = useCallback(() => {
    if (selectedReport) {
      setDismissDialogSurface("detail_pane");
      setDismissReport(selectedReport);
    }
  }, [selectedReport]);

  const dismissMutationPending =
    dismissReport != null &&
    (dismissBulkActions.isSuppressing || dismissBulkActions.isSnoozing);

  // Stable refs so callbacks don't need re-registration on every render
  const selectedReportIdsRef = useRef(selectedReportIds);
  selectedReportIdsRef.current = selectedReportIds;
  const reportsRef = useRef(reports);
  reportsRef.current = reports;

  // Reports for the multi-select stack (when 2+ selected)
  const selectedReports = useMemo(() => {
    if (selectedReportIds.length < 2) return [];
    const idSet = new Set(selectedReportIds);
    return reports.filter((r) => idSet.has(r.id));
  }, [reports, selectedReportIds]);

  // ── Click handler: plain / cmd / shift ──────────────────────────────────
  const handleReportClick = useCallback(
    (reportId: string, event: { metaKey: boolean; shiftKey: boolean }) => {
      if (event.shiftKey) {
        setPendingInboxOpenMethod("click_shift");
        selectRange(
          reportId,
          reportsRef.current.map((r) => r.id),
        );
      } else if (event.metaKey) {
        setPendingInboxOpenMethod("click_cmd");
        toggleReportSelection(reportId);
      } else {
        // Plain click — select only this report (no-op if already the sole selection)
        setPendingInboxOpenMethod("click");
        setSelectedReportIds([reportId]);
      }
    },
    [selectRange, toggleReportSelection, setSelectedReportIds],
  );

  // Select-all checkbox
  const handleToggleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedReportIds(reportsRef.current.map((r) => r.id));
      } else {
        clearSelection();
      }
    },
    [setSelectedReportIds, clearSelection],
  );

  // ── Sidebar resize ─────────────────────────────────────────────────────
  const sidebarWidth = useInboxSignalsSidebarStore((state) => state.width);
  const sidebarIsResizing = useInboxSignalsSidebarStore(
    (state) => state.isResizing,
  );
  const setSidebarWidth = useInboxSignalsSidebarStore(
    (state) => state.setWidth,
  );
  const setSidebarIsResizing = useInboxSignalsSidebarStore(
    (state) => state.setIsResizing,
  );
  const containerRef = useRef<HTMLDivElement>(null);

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setSidebarIsResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [setSidebarIsResizing],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!sidebarIsResizing || !containerRef.current) return;
      const containerLeft = containerRef.current.getBoundingClientRect().left;
      const containerWidth = containerRef.current.offsetWidth;
      const maxWidth = containerWidth * 0.6;
      const newWidth = Math.max(
        220,
        Math.min(maxWidth, e.clientX - containerLeft),
      );
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => {
      if (sidebarIsResizing) {
        setSidebarIsResizing(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [sidebarIsResizing, setSidebarWidth, setSidebarIsResizing]);

  // ── Layout mode (computed early — needed by focus effect below) ────────
  const hasReports = allReports.length > 0;
  const hasActiveFilters =
    sourceProductFilter.length > 0 ||
    suggestedReviewerFilter.length > 0 ||
    priorityFilter.length > 0 ||
    statusFilter.length < 5;

  // Sticky for the visit: once entered, only "Proceed to Inbox" or unmount exits.
  // Gated on prerequisites loading so we don't latch users who already have a
  // configured inbox.
  const [hasEnteredOnboarding, setHasEnteredOnboarding] = useState(false);
  const [userExitedOnboarding, setUserExitedOnboarding] = useState(false);
  useEffect(() => {
    if (
      inboxSourcesPrerequisitesLoaded &&
      !isLoading &&
      error == null &&
      !hasReports &&
      !hasSignalSources
    ) {
      setHasEnteredOnboarding(true);
    }
  }, [
    inboxSourcesPrerequisitesLoaded,
    isLoading,
    error,
    hasReports,
    hasSignalSources,
  ]);

  const showInboxOnboarding = hasEnteredOnboarding && !userExitedOnboarding;
  const shouldShowTwoPane =
    !showInboxOnboarding &&
    (hasReports || !!searchQuery.trim() || hasActiveFilters);

  // Sticky: once we enter two-pane mode, stay there even if a refetch
  // momentarily empties the list (e.g. when sort order changes).
  const hasMountedTwoPaneRef = useRef(false);
  if (shouldShowTwoPane) {
    hasMountedTwoPaneRef.current = true;
  }
  const showTwoPaneLayout = hasMountedTwoPaneRef.current;

  // ── Inbox viewed analytics — fire once per visit when data settles ─────
  const inboxViewedFiredRef = useRef(false);
  useEffect(() => {
    if (!isInboxView) {
      inboxViewedFiredRef.current = false;
      return;
    }
    if (isLoading) return;
    if (inboxViewedFiredRef.current) return;
    inboxViewedFiredRef.current = true;
    const priorityCounts = {
      P0: 0,
      P1: 0,
      P2: 0,
      P3: 0,
      P4: 0,
      unknown: 0,
    };
    const actionabilityCounts = {
      immediately_actionable: 0,
      requires_human_input: 0,
      not_actionable: 0,
      unknown: 0,
    };
    for (const r of reports) {
      const p = r.priority;
      if (p === "P0" || p === "P1" || p === "P2" || p === "P3" || p === "P4") {
        priorityCounts[p] += 1;
      } else {
        priorityCounts.unknown += 1;
      }
      const a = r.actionability;
      if (
        a === "immediately_actionable" ||
        a === "requires_human_input" ||
        a === "not_actionable"
      ) {
        actionabilityCounts[a] += 1;
      } else {
        actionabilityCounts.unknown += 1;
      }
    }
    track(ANALYTICS_EVENTS.INBOX_VIEWED, {
      report_count: reports.length,
      total_count: totalCount,
      ready_count: readyCount,
      has_active_filters: hasActiveFilters,
      source_product_filter: sourceProductFilter,
      status_filter_count: statusFilter.length,
      is_empty: totalCount === 0,
      is_gated_due_to_scale: false,
      priority_p0_count: priorityCounts.P0,
      priority_p1_count: priorityCounts.P1,
      priority_p2_count: priorityCounts.P2,
      priority_p3_count: priorityCounts.P3,
      priority_p4_count: priorityCounts.P4,
      priority_unknown_count: priorityCounts.unknown,
      actionability_immediately_actionable_count:
        actionabilityCounts.immediately_actionable,
      actionability_requires_human_input_count:
        actionabilityCounts.requires_human_input,
      actionability_not_actionable_count: actionabilityCounts.not_actionable,
      actionability_unknown_count: actionabilityCounts.unknown,
    });
  }, [
    isInboxView,
    isLoading,
    reports,
    totalCount,
    readyCount,
    hasActiveFilters,
    sourceProductFilter,
    statusFilter.length,
  ]);

  // ── Arrow-key navigation between reports ──────────────────────────────
  const leftPaneRef = useRef<HTMLDivElement>(null);

  const focusListPane = useCallback(() => {
    requestAnimationFrame(() => {
      leftPaneRef.current?.focus();
    });
  }, []);

  // Auto-focus the list pane when the two-pane layout appears
  useEffect(() => {
    if (showTwoPaneLayout) {
      focusListPane();
    }
  }, [focusListPane, showTwoPaneLayout]);

  // Tracks the cursor position for keyboard navigation (the "moving end" of
  // Shift+Arrow selection). Separated from `lastClickedId` which acts as the
  // anchor so that the anchor stays fixed while the cursor extends the range.
  const keyboardCursorIdRef = useRef<string | null>(null);

  const navigateReport = useCallback(
    (direction: 1 | -1, shift: boolean) => {
      const list = reportsRef.current;
      if (list.length === 0) return;

      // Determine cursor position — the item to navigate away from
      const cursorId =
        keyboardCursorIdRef.current ??
        (selectedReportIdsRef.current.length > 0
          ? selectedReportIdsRef.current[
              selectedReportIdsRef.current.length - 1
            ]
          : null);
      const cursorIndex = cursorId
        ? list.findIndex((r) => r.id === cursorId)
        : -1;
      const nextIndex =
        cursorIndex === -1
          ? 0
          : Math.max(0, Math.min(list.length - 1, cursorIndex + direction));
      const nextId = list[nextIndex].id;

      if (shift) {
        // Anchor is the store's lastClickedId — the point where shift-selection started.
        // selectExactRange replaces the selection with the exact range from anchor to cursor,
        // so reversing direction correctly contracts the selection.
        const anchor =
          useInboxReportSelectionStore.getState().lastClickedId ?? nextId;
        setPendingInboxOpenMethod("keyboard");
        selectExactRange(
          anchor,
          nextId,
          list.map((r) => r.id),
        );
        keyboardCursorIdRef.current = nextId;
      } else {
        setPendingInboxOpenMethod("keyboard");
        setSelectedReportIds([nextId]);
        keyboardCursorIdRef.current = nextId;
      }

      const container = leftPaneRef.current;
      const row = container?.querySelector<HTMLElement>(
        `[data-report-id="${nextId}"]`,
      );
      const stickyHeader = container?.querySelector<HTMLElement>(
        "[data-inbox-sticky-header]",
      );

      if (!row) return;

      const stickyHeaderHeight = stickyHeader?.offsetHeight ?? 0;
      row.style.scrollMarginTop = `${stickyHeaderHeight}px`;
      row.scrollIntoView({ block: "nearest" });
    },
    [setSelectedReportIds, selectExactRange],
  );

  // Window-level keyboard handler so arrow keys work regardless of which
  // pane has focus — only suppressed inside interactive widgets.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't capture when any Radix overlay or interactive widget is open
      if (
        document.querySelector(
          "[data-radix-popper-content-wrapper], [role='dialog'][data-state='open']",
        )
      )
        return;

      const target = e.target as HTMLElement;
      if (target.closest("input, select, textarea")) return;
      if (e.key === " " && target.closest("button, [role='checkbox']")) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        navigateReport(1, e.shiftKey);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        navigateReport(-1, e.shiftKey);
      } else if (
        e.key === "Escape" &&
        selectedReportIdsRef.current.length > 0
      ) {
        e.preventDefault();
        clearSelection();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigateReport, clearSelection]);

  const searchDisabledReason =
    !hasReports && !searchQuery.trim()
      ? "No reports in the project\u2026 yet"
      : null;

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <>
      {showInboxOnboarding ? (
        // Inline setup pane for users with no sources configured.
        // The toolbar (report counter, search, bulk actions) is suppressed
        // entirely — none of it is meaningful before any source is configured.
        // Sticky within the visit: stays until the user clicks "Proceed to
        // Inbox" inside the pane or navigates away.
        <ScrollArea className="h-full">
          <InboxSetupPane
            hasSignalSources={hasSignalSources}
            onProceedToInbox={() => setUserExitedOnboarding(true)}
          />
        </ScrollArea>
      ) : showTwoPaneLayout ? (
        <Flex ref={containerRef} height="100%" className="min-h-0">
          {/* ── Left pane: report list ───────────────────────────────── */}
          <Box
            className="relative h-full max-w-[60%] flex-none select-none overflow-hidden border-r border-r-(--gray-5)"
            style={{
              width: `${sidebarWidth}px`,
            }}
          >
            <ScrollArea
              type="auto"
              className="scroll-area-constrain-width inbox-report-list-scroll h-full"
            >
              <Flex
                ref={leftPaneRef}
                direction="column"
                tabIndex={0}
                className="outline-none"
                // Clicking a row/button/checkbox would normally move browser focus to that
                // element, losing the container's focus and breaking arrow-key navigation.
                // Intercept mousedown to redirect focus back to the container instead.
                // Text fields are exempt so the search box can still receive focus normally.
                onMouseDownCapture={(e) => {
                  const target = e.target as HTMLElement;
                  if (
                    target.closest(
                      "input, textarea, select, [contenteditable='true']",
                    )
                  ) {
                    return;
                  }
                  if (target.closest("[data-report-id], button")) {
                    focusListPane();
                  }
                }}
                // Same redirect for focus arriving via keyboard (Tab) — if focus lands
                // inside a row element rather than on the container itself, pull it back up.
                onFocusCapture={(e) => {
                  const target = e.target as HTMLElement;
                  if (
                    target.closest(
                      "input, textarea, select, [contenteditable='true']",
                    )
                  ) {
                    return;
                  }
                  if (
                    target !== leftPaneRef.current &&
                    target.closest("[data-report-id], button")
                  ) {
                    focusListPane();
                  }
                }}
              >
                <Box
                  data-inbox-sticky-header
                  className="sticky top-0 z-10 bg-(--color-background)"
                >
                  <SignalsToolbar
                    totalCount={totalCount}
                    filteredCount={reports.length}
                    isSearchActive={!!searchQuery.trim()}
                    livePolling={inboxPollingActive}
                    isFetching={isFetching}
                    readyCount={readyCount}
                    processingCount={processingCount}
                    pipelinePausedUntil={signalProcessingState?.paused_until}
                    reports={reports}
                    effectiveBulkIds={selectedReportIds}
                    onToggleSelectAll={handleToggleSelectAll}
                    onConfigureSources={() => setSourcesDialogOpen(true)}
                    onOpenDismissDialog={openDismissDialogFromToolbar}
                    isDismissMutationPending={dismissMutationPending}
                    onReportAction={tracker.signalAction}
                  />
                </Box>
                <ReportListPane
                  reports={reports}
                  allReports={allReports}
                  isLoading={isLoading}
                  isFetching={isFetching}
                  error={error}
                  refetch={refetch}
                  hasNextPage={hasNextPage}
                  isFetchingNextPage={isFetchingNextPage}
                  fetchNextPage={fetchNextPage}
                  hasSignalSources={hasSignalSources}
                  searchQuery={searchQuery}
                  hasActiveFilters={hasActiveFilters}
                  selectedReportIds={selectedReportIds}
                  onReportClick={handleReportClick}
                  onToggleReportSelection={toggleReportSelection}
                />
              </Flex>
            </ScrollArea>

            <GitHubConnectionBanner />

            {/* Resize handle */}
            <Box
              onMouseDown={handleResizeMouseDown}
              className="no-drag absolute top-0 right-0 bottom-0 w-[4px] cursor-col-resize bg-transparent"
              style={{
                zIndex: 100,
              }}
            />
          </Box>

          {/* ── Right pane: detail ───────────────────────────────── */}
          <Flex
            direction="column"
            className="@container relative h-full min-w-0 flex-1"
          >
            {selectedReports.length > 1 ? (
              <MultiSelectStack
                reports={selectedReports}
                onClearSelection={clearSelection}
              />
            ) : selectedReport ? (
              <ReportDetailPane
                report={selectedReport}
                onClose={clearSelection}
                onRequestDismissReport={openDismissDialogFromDetailPane}
                suppressDisabledReason={inboxBulkSuppressDisabledReason(
                  allReports,
                  [selectedReport.id],
                )}
                isDismissMutationPending={dismissMutationPending}
                onReportAction={tracker.signalAction}
                onScroll={tracker.signalScroll}
              />
            ) : (
              <SelectReportPane />
            )}
          </Flex>
        </Flex>
      ) : (
        // Full-width warming-up state with skeleton backdrop
        <Box className="relative h-full">
          <Flex direction="column">
            <SignalsToolbar
              totalCount={0}
              filteredCount={0}
              isSearchActive={false}
              pipelinePausedUntil={signalProcessingState?.paused_until}
              searchDisabledReason={searchDisabledReason}
              hideFilters
              onConfigureSources={() => setSourcesDialogOpen(true)}
            />
            <SkeletonBackdrop />
          </Flex>
          <Box
            style={{
              background:
                "linear-gradient(to bottom, transparent 0%, var(--color-background) 30%)",
            }}
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <Box className="pointer-events-auto">
              <WarmingUpPane
                onConfigureSources={() => setSourcesDialogOpen(true)}
                enabledProducts={enabledProducts}
              />
            </Box>
          </Box>
        </Box>
      )}

      {/* ── Sources config dialog ──────────────────────────────── */}
      <InboxSourcesDialog
        open={sourcesDialogOpen}
        onOpenChange={setSourcesDialogOpen}
        hasSignalSources={hasSignalSources}
        hasGithubIntegration={hasGithubIntegration}
      />

      {dismissReport != null ? (
        <DismissReportDialog
          key={dismissReport.id}
          open
          onOpenChange={handleDismissDialogOpenChange}
          report={dismissReport}
          isSubmitting={
            dismissBulkActions.isSuppressing || dismissBulkActions.isSnoozing
          }
          snoozeDisabledReason={inboxBulkSnoozeDisabledReason(allReports, [
            dismissReport.id,
          ])}
          onConfirm={(result) => void handleDismissConfirm(result)}
        />
      ) : null}
    </>
  );
}
