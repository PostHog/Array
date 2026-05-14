import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FilterSheet } from "@/features/inbox/components/FilterSheet";
import { FloatingInboxHeader } from "@/features/inbox/components/FloatingInboxHeader";
import { InboxViewToggle } from "@/features/inbox/components/InboxViewToggle";
import { ReportList } from "@/features/inbox/components/ReportList";
import { ReviewerFilterSheet } from "@/features/inbox/components/ReviewerFilterSheet";
import { TinderView } from "@/features/inbox/components/TinderView";
import { useInboxReports } from "@/features/inbox/hooks/useInboxReports";
import { useDismissedReportsStore } from "@/features/inbox/stores/dismissedReportsStore";
import { useInboxFilterStore } from "@/features/inbox/stores/inboxFilterStore";
import { useInboxStore } from "@/features/inbox/stores/inboxStore";
import type { SignalReport } from "@/features/inbox/types";
import { useIntegrations } from "@/features/tasks/hooks/useIntegrations";

type InboxViewMode = "list" | "tinder";

export default function InboxScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { reports, isFetching, isLoading, error } = useInboxReports();
  const [filterOpen, setFilterOpen] = useState(false);
  const [reviewerOpen, setReviewerOpen] = useState(false);
  const [viewMode, setViewMode] = useState<InboxViewMode>("list");
  const reviewerFilterCount = useInboxFilterStore(
    (s) => s.suggestedReviewerFilter.length,
  );

  // ── Tinder mode data ──────────────────────────────────────────────────────
  const dismissedIds = useDismissedReportsStore((s) => s.dismissedIds);
  const setCurrentIndex = useInboxStore((s) => s.setCurrentIndex);
  const { repositoryOptions } = useIntegrations();

  // Same data as the list view, just excluding dismissed reports.
  const tinderReports = useMemo(
    () => reports.filter((r) => !dismissedIds.includes(r.id)),
    [reports, dismissedIds],
  );

  // Reset card index when switching to tinder mode
  useEffect(() => {
    if (viewMode === "tinder") {
      setCurrentIndex(0);
    }
  }, [viewMode, setCurrentIndex]);

  // ── List mode handlers ────────────────────────────────────────────────────
  const handleReportPress = useCallback(
    (report: SignalReport) => {
      router.push(`/report/${report.id}`);
    },
    [router],
  );

  // Header occupies insets.top + 6 (top pad) + 40 (MenuButton) + 8 (bottom
  // pad), plus a small buffer so the first row isn't hugging the fade edge.
  const headerHeight = insets.top + 60;

  return (
    <View className="flex-1 bg-background">
      {viewMode === "list" ? (
        <ReportList
          onReportPress={handleReportPress}
          contentInsetTop={headerHeight}
        />
      ) : (
        <View style={{ paddingTop: headerHeight }} className="flex-1">
          <TinderView
            reports={tinderReports}
            repositoryOptions={repositoryOptions}
            isLoading={isLoading}
          />
        </View>
      )}

      <FloatingInboxHeader
        isFetching={isFetching}
        hasError={!!error}
        reviewerFilterCount={reviewerFilterCount}
        onReviewerPress={() => setReviewerOpen(true)}
        onFilterPress={() => setFilterOpen(true)}
      />

      <InboxViewToggle mode={viewMode} onModeChange={setViewMode} />

      <FilterSheet visible={filterOpen} onClose={() => setFilterOpen(false)} />
      <ReviewerFilterSheet
        visible={reviewerOpen}
        onClose={() => setReviewerOpen(false)}
      />
    </View>
  );
}
