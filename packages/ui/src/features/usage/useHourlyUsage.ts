import type { SpendAnalysisResponse } from "@posthog/api-client/spend-analysis";
import {
  fillSpendHours,
  type SpendAnalysisFilledHour,
} from "@posthog/core/billing/spendAnalysisFormat";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { logger } from "@posthog/ui/shell/logger";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

const log = logger.scope("hourly-usage");

const HOURLY_USAGE_STALE_TIME_MS = 60_000;

interface UseHourlyUsageOptions {
  product?: string;
}

interface UseHourlyUsageReturn {
  // null while loading or when the backend doesn't return `by_hour` yet.
  hours: SpendAnalysisFilledHour[] | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Last-24h personal spend at hourly resolution, zero-filled so the chart
 * always renders a continuous series.
 */
export function useHourlyUsage({
  product,
}: UseHourlyUsageOptions): UseHourlyUsageReturn {
  const client = useOptionalAuthenticatedClient();
  const query = useQuery({
    queryKey: ["billing", "hourly-usage", product ?? "all"],
    queryFn: async (): Promise<SpendAnalysisResponse> => {
      if (!client) throw new Error("Not authenticated");
      try {
        return await client.getPersonalSpendAnalysis({
          dateFrom: "-24h",
          product,
          hourly: true,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        log.warn("Failed to fetch hourly usage", { error: message });
        throw err;
      }
    },
    enabled: client !== null,
    staleTime: HOURLY_USAGE_STALE_TIME_MS,
  });

  const hours = useMemo(() => {
    const data = query.data;
    if (!data?.by_hour) return null;
    return fillSpendHours(
      data.by_hour.items,
      data.summary.date_from,
      data.summary.date_to,
    );
  }, [query.data]);

  return {
    hours,
    // Not isPending: it stays true forever while the query is disabled pre-auth.
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: () => {
      void query.refetch();
    },
  };
}
