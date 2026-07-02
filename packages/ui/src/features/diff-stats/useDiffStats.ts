import { useHostTRPC } from "@posthog/host-router/react";
import { useQuery } from "@tanstack/react-query";

const EMPTY_DIFF_STATS = { filesChanged: 0, linesAdded: 0, linesRemoved: 0 };

export interface UseDiffStatsOptions {
  enabled?: boolean;
}

/**
 * Working-tree diff stats for the header badge / session chip.
 *
 * Deliberately reads the same `git.getDiffStats` query that `useGitQueries`
 * (the changes panel + PR button) and the diff panel rely on, so the numbers
 * share one cache entry and one fetch, and refresh off the same file-watcher
 * invalidation (`invalidateGitWorkingTreeQueries`). A separate transport with
 * its own poll interval used to back this and drifted out of sync with the
 * panel; keep it unified.
 */
export function useDiffStats(
  directoryPath: string | null,
  options: UseDiffStatsOptions = {},
) {
  const trpc = useHostTRPC();
  return useQuery(
    trpc.git.getDiffStats.queryOptions(
      { directoryPath: directoryPath ?? "" },
      {
        enabled: (options.enabled ?? true) && !!directoryPath,
        staleTime: 30_000,
        placeholderData: (prev) => prev ?? EMPTY_DIFF_STATS,
      },
    ),
  );
}
