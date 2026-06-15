import {
  buildPriorityFilterParam,
  buildSignalReportListOrdering,
  buildSuggestedReviewerFilterParam,
  filterReportsBySearch,
  INBOX_PIPELINE_STATUS_FILTER,
  INBOX_REFETCH_INTERVAL_MS,
} from "@posthog/core/inbox/reportFiltering";
import {
  computeInboxTabCounts,
  matchesReviewerScope,
  parseTeammateInboxScope,
} from "@posthog/core/inbox/reportMembership";
import { useInboxReportsInfinite } from "@posthog/ui/features/inbox/hooks/useInboxReports";
import { useInboxReviewerScopeStore } from "@posthog/ui/features/inbox/stores/inboxReviewerScopeStore";
import { useInboxSignalsFilterStore } from "@posthog/ui/features/inbox/stores/inboxSignalsFilterStore";
import { useMemo } from "react";

// Module-level stable references — selectors returning these never trigger a
// re-render on store updates (Object.is comparison).
const EMPTY_FILTER_ARRAY: never[] = [];

/**
 * `ignoreScope` skips the For-you / Entire-project filter on the returned
 * list. `ignoreFilters` skips the user's source/priority/search/ordering
 * choices and hard-pins ordering to newest-first. Both are used by the
 * Runs tab, where the agent's work is project-wide and the cross-tab
 * filter chrome doesn't meaningfully apply.
 *
 * When `ignoreFilters` is set, the filter-store selectors return constant
 * values so unrelated filter changes don't re-render the consumer.
 */
export function useInboxAllReports(options?: {
  ignoreScope?: boolean;
  ignoreFilters?: boolean;
}) {
  const ignoreScope = options?.ignoreScope ?? false;
  const ignoreFilters = options?.ignoreFilters ?? false;
  const scope = useInboxReviewerScopeStore((s) => s.scope);
  const searchQuery = useInboxSignalsFilterStore((s) =>
    ignoreFilters ? "" : s.searchQuery,
  );
  const sortField = useInboxSignalsFilterStore((s) =>
    ignoreFilters ? "updated_at" : s.sortField,
  );
  const sortDirection = useInboxSignalsFilterStore((s) =>
    ignoreFilters ? "desc" : s.sortDirection,
  );
  const sourceProductFilter = useInboxSignalsFilterStore((s) =>
    ignoreFilters ? EMPTY_FILTER_ARRAY : s.sourceProductFilter,
  );
  const priorityFilter = useInboxSignalsFilterStore((s) =>
    ignoreFilters ? EMPTY_FILTER_ARRAY : s.priorityFilter,
  );
  const teammateUuid = ignoreScope ? null : parseTeammateInboxScope(scope);

  const query = useInboxReportsInfinite(
    {
      status: INBOX_PIPELINE_STATUS_FILTER,
      ordering: buildSignalReportListOrdering(sortField, sortDirection),
      source_product:
        sourceProductFilter.length > 0
          ? sourceProductFilter.join(",")
          : undefined,
      priority: buildPriorityFilterParam(priorityFilter),
      suggested_reviewers: teammateUuid
        ? buildSuggestedReviewerFilterParam([teammateUuid])
        : undefined,
    },
    {
      refetchInterval: INBOX_REFETCH_INTERVAL_MS,
      refetchIntervalInBackground: false,
    },
  );

  const scopedReports = useMemo(() => {
    const byScope = ignoreScope
      ? query.allReports
      : query.allReports.filter((r) => matchesReviewerScope(r, scope));
    return searchQuery.trim()
      ? filterReportsBySearch(byScope, searchQuery)
      : byScope;
  }, [query.allReports, scope, searchQuery, ignoreScope]);

  const counts = useMemo(
    () => computeInboxTabCounts(query.allReports, scope),
    [query.allReports, scope],
  );

  return {
    ...query,
    scopedReports,
    counts,
    scope,
    // The effective filter values used for this query. Surfaced so consumers
    // (e.g. analytics) can read them without subscribing to the filter store a
    // second time. Reflect `ignoreFilters`, so they are empty when filters are
    // ignored.
    searchQuery,
    sourceProductFilter,
    priorityFilter,
  };
}
