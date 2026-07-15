import type { SpendAnalysisResponse } from "@posthog/api-client/spend-analysis";
import {
  fillSpendBuckets,
  type SpendAnalysisFilledBucket,
} from "@posthog/core/billing/spendAnalysisFormat";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { logger } from "@posthog/ui/shell/logger";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

const log = logger.scope("recent-usage");

const RECENT_USAGE_STALE_TIME_MS = 60_000;

// 5-minute buckets match the prompt-cache TTL, so one bucket ≈ one turn:
// a cold-revival spike stands alone instead of being diluted across an hour.
export const RECENT_USAGE_BUCKET_MINUTES = 5;

interface UseRecentUsageOptions {
  product?: string;
}

interface UseRecentUsageReturn {
  // null while loading or when the backend doesn't return `by_bucket` yet.
  buckets: SpendAnalysisFilledBucket[] | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Last-24h personal spend at 5-minute resolution, zero-filled so the chart
 * always renders a continuous series.
 */
export function useRecentUsage({
  product,
}: UseRecentUsageOptions): UseRecentUsageReturn {
  const client = useOptionalAuthenticatedClient();
  const query = useQuery({
    queryKey: ["billing", "recent-usage", product ?? "all"],
    queryFn: async (): Promise<SpendAnalysisResponse> => {
      if (!client) throw new Error("Not authenticated");
      try {
        return await client.getPersonalSpendAnalysis({
          dateFrom: "-24h",
          product,
          bucketMinutes: RECENT_USAGE_BUCKET_MINUTES,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        log.warn("Failed to fetch recent usage", { error: message });
        throw err;
      }
    },
    enabled: client !== null,
    staleTime: RECENT_USAGE_STALE_TIME_MS,
  });

  const buckets = useMemo(() => {
    const data = query.data;
    if (!data?.by_bucket) return null;
    return fillSpendBuckets(
      data.by_bucket.items,
      data.summary.date_from,
      data.summary.date_to,
      data.by_bucket.bucket_minutes,
    );
  }, [query.data]);

  return {
    buckets,
    // Not isPending: it stays true forever while the query is disabled pre-auth.
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: () => {
      void query.refetch();
    },
  };
}
