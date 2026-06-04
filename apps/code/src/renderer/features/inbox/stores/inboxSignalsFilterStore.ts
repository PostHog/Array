import type {
  SignalReportOrderingField,
  SignalReportPriority,
  SignalReportStatus,
} from "@shared/types";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type SignalSortField = Extract<
  SignalReportOrderingField,
  "priority" | "created_at" | "total_weight"
>;

type SignalSortDirection = "asc" | "desc";

export type SourceProduct =
  | "session_replay"
  | "error_tracking"
  | "llm_analytics"
  | "github"
  | "linear"
  | "zendesk"
  | "conversations"
  | "pganalyze";

const DEFAULT_STATUS_FILTER: SignalReportStatus[] = [
  "ready",
  "pending_input",
  "in_progress",
  "failed",
  "candidate",
  "potential",
];

interface InboxSignalsFilterState {
  sortField: SignalSortField;
  sortDirection: SignalSortDirection;
  searchQuery: string;
  statusFilter: SignalReportStatus[];
  /** Empty array means "all sources" (no filter). */
  sourceProductFilter: SourceProduct[];
  /** Empty array means "all suggested reviewers" (no filter). Stored as PostHog user UUID strings. */
  suggestedReviewerFilter: string[];
  /** Tracks whether we've seeded the reviewer filter with the current user once. Persisted so the seed only runs on first inbox visit. */
  hasInitializedSuggestedReviewerFilter: boolean;
  /** Empty array means "all priorities" (no filter). */
  priorityFilter: SignalReportPriority[];
}

interface InboxSignalsFilterActions {
  setSort: (field: SignalSortField, direction: SignalSortDirection) => void;
  setSearchQuery: (query: string) => void;
  setStatusFilter: (statuses: SignalReportStatus[]) => void;
  toggleStatus: (status: SignalReportStatus) => void;
  toggleSourceProduct: (source: SourceProduct) => void;
  toggleSuggestedReviewer: (reviewerUuid: string) => void;
  setSuggestedReviewerFilter: (reviewerUuids: string[]) => void;
  /**
   * Seed the reviewer filter with the current user on first inbox visit.
   * No-op if already initialized, or if the user has actively chosen reviewers.
   * Always flips the initialized flag so we don't override later user choices.
   */
  seedSuggestedReviewerFilterWithCurrentUser: (currentUserUuid: string) => void;
  togglePriority: (priority: SignalReportPriority) => void;
  setPriorityFilter: (priorities: SignalReportPriority[]) => void;
  /** Reset all filters when a deep link arrives so the linked report isn't hidden. */
  resetFilters: () => void;
}

type InboxSignalsFilterStore = InboxSignalsFilterState &
  InboxSignalsFilterActions;

export const useInboxSignalsFilterStore = create<InboxSignalsFilterStore>()(
  persist(
    (set) => ({
      sortField: "priority",
      sortDirection: "asc",
      searchQuery: "",
      statusFilter: DEFAULT_STATUS_FILTER,
      sourceProductFilter: [],
      suggestedReviewerFilter: [],
      hasInitializedSuggestedReviewerFilter: false,
      priorityFilter: [],
      setSort: (sortField, sortDirection) => set({ sortField, sortDirection }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setStatusFilter: (statusFilter) => set({ statusFilter }),
      toggleStatus: (status) =>
        set((state) => {
          const current = state.statusFilter;
          const next = current.includes(status)
            ? current.filter((s) => s !== status)
            : [...current, status];
          return { statusFilter: next.length > 0 ? next : current };
        }),
      toggleSourceProduct: (source) =>
        set((state) => {
          const current = state.sourceProductFilter;
          const next = current.includes(source)
            ? current.filter((s) => s !== source)
            : [...current, source];
          return { sourceProductFilter: next };
        }),
      toggleSuggestedReviewer: (reviewerUuid) =>
        set((state) => {
          const current = state.suggestedReviewerFilter;
          const next = current.includes(reviewerUuid)
            ? current.filter((uuid) => uuid !== reviewerUuid)
            : [...current, reviewerUuid];
          return { suggestedReviewerFilter: next };
        }),
      setSuggestedReviewerFilter: (reviewerUuids) =>
        set({
          suggestedReviewerFilter: Array.from(new Set(reviewerUuids)),
        }),
      seedSuggestedReviewerFilterWithCurrentUser: (currentUserUuid) =>
        set((state) => {
          if (state.hasInitializedSuggestedReviewerFilter) return {};
          return {
            hasInitializedSuggestedReviewerFilter: true,
            suggestedReviewerFilter:
              state.suggestedReviewerFilter.length === 0
                ? [currentUserUuid]
                : state.suggestedReviewerFilter,
          };
        }),
      togglePriority: (priority) =>
        set((state) => {
          const current = state.priorityFilter;
          const next = current.includes(priority)
            ? current.filter((p) => p !== priority)
            : [...current, priority];
          return { priorityFilter: next };
        }),
      setPriorityFilter: (priorities) =>
        set({
          priorityFilter: Array.from(new Set(priorities)),
        }),
      resetFilters: () =>
        set({
          searchQuery: "",
          statusFilter: DEFAULT_STATUS_FILTER,
          sourceProductFilter: [],
          suggestedReviewerFilter: [],
          priorityFilter: [],
        }),
    }),
    {
      name: "inbox-signals-filter-storage",
      partialize: (state) => ({
        sortField: state.sortField,
        sortDirection: state.sortDirection,
        statusFilter: state.statusFilter,
        sourceProductFilter: state.sourceProductFilter,
        suggestedReviewerFilter: state.suggestedReviewerFilter,
        hasInitializedSuggestedReviewerFilter:
          state.hasInitializedSuggestedReviewerFilter,
        priorityFilter: state.priorityFilter,
      }),
    },
  ),
);
