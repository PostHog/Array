import type {
  DashboardDateRange,
  DashboardRecord,
} from "@posthog/core/canvas/dashboardSchemas";
import { useHostTRPC } from "@posthog/host-router/react";
import {
  liveWindow,
  readStoredRange,
} from "@posthog/ui/features/canvas/dateRange";
import { toast } from "@posthog/ui/primitives/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

interface RefreshOptions {
  /** Limit the refresh to these elements' subtrees (per-card refresh). */
  elementKeys?: string[];
  /** Skip bumping updatedAt (background polling) to avoid list reordering. */
  touchUpdatedAt?: boolean;
  /** Override the time window (an explicit user pick); else the rolled stored one. */
  dateRange?: DashboardDateRange;
  /** Persist `dateRange` onto the spec (only an explicit pick should). */
  persistRange?: boolean;
}

/**
 * Re-runs the HogQL queries stored on a dashboard's data points (in main),
 * writes fresh values to the file, then refetches it. `refresh([cardKey])`
 * refreshes a single card.
 */
export function useRefreshDashboard(dashboardId: string): {
  refresh: (options?: RefreshOptions) => Promise<void>;
  isRefreshing: boolean;
} {
  const trpc = useHostTRPC();
  const queryClient = useQueryClient();
  const refreshMutation = useMutation(
    trpc.dashboards.refresh.mutationOptions(),
  );

  const refresh = useCallback(
    async (options?: RefreshOptions) => {
      try {
        // Read the board's stored window from cache at call-time (no extra
        // subscription) so EVERY refresh (manual, polling, per-card) rolls a named
        // range ("Last 7 days") to now. An explicit pick wins (and persists);
        // otherwise roll the stored range and substitute only (don't rewrite).
        const cached = queryClient.getQueryData<DashboardRecord>(
          trpc.dashboards.get.queryKey({ id: dashboardId }),
        );
        const dateRange =
          options?.dateRange ?? liveWindow(readStoredRange(cached?.spec));
        const persistRange = options?.dateRange
          ? (options.persistRange ?? true)
          : false;
        const result = await refreshMutation.mutateAsync({
          id: dashboardId,
          elementKeys: options?.elementKeys,
          touchUpdatedAt: options?.touchUpdatedAt,
          dateRange: dateRange ?? undefined,
          persistRange,
        });
        await queryClient.invalidateQueries(trpc.dashboards.get.pathFilter());
        const failed = result.failures.length;
        if (failed > 0) {
          toast.error(
            `${failed} data point${failed === 1 ? "" : "s"} couldn't refresh`,
            { description: result.failures[0]?.error },
          );
        }
      } catch (error) {
        toast.error("Couldn't refresh canvas", {
          description: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [dashboardId, refreshMutation, queryClient, trpc],
  );

  return { refresh, isRefreshing: refreshMutation.isPending };
}
