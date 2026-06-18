import { useWorkspaceTRPC } from "@posthog/workspace-client/trpc";
import { useQuery } from "@tanstack/react-query";

const DEFAULT_REFETCH_INTERVAL_MS = 30_000;

export interface UseDiffStatsOptions {
  enabled?: boolean;
  refetchInterval?: number;
}

export function useDiffStats(
  directoryPath: string | null,
  options: UseDiffStatsOptions = {},
) {
  const trpc = useWorkspaceTRPC();
  return useQuery(
    trpc.diffStats.getDiffStats.queryOptions(
      { directoryPath: directoryPath ?? "" },
      {
        enabled: (options.enabled ?? true) && !!directoryPath,
        refetchInterval: options.refetchInterval ?? DEFAULT_REFETCH_INTERVAL_MS,
      },
    ),
  );
}
