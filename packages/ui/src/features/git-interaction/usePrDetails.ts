import { useHostTRPC } from "@posthog/host-router/react";
import type { PrReviewThread } from "@posthog/shared";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { PrCommentThread } from "../code-review/prCommentAnnotations";

interface UsePrDetailsOptions {
  includeComments?: boolean;
}

function threadsToMap(threads: PrReviewThread[]): Map<number, PrCommentThread> {
  const map = new Map<number, PrCommentThread>();
  for (const thread of threads) {
    map.set(thread.rootId, {
      rootId: thread.rootId,
      nodeId: thread.nodeId,
      isResolved: thread.isResolved,
      comments: thread.comments,
      filePath: thread.filePath,
    });
  }
  return map;
}

export interface PrStateDetails {
  state: string;
  merged: boolean;
  draft: boolean;
}

/**
 * Fetch lifecycle state for a set of PRs at once (the "Other PRs" submenu).
 * Also serves as a prefetch: it warms the same `getPrDetailsByUrl` cache
 * `usePrDetails` reads, so promoting one of these PRs renders its badge with
 * the correct state instantly.
 */
export function usePrDetailsMap(
  prUrls: string[],
): Record<string, PrStateDetails> {
  const trpc = useHostTRPC();
  return useQueries({
    queries: prUrls.map((prUrl) => ({
      ...trpc.git.getPrDetailsByUrl.queryOptions({ prUrl }),
      staleTime: 60_000,
      retry: 1,
    })),
    combine: (results) =>
      Object.fromEntries(
        results.flatMap((result, i) =>
          result.data && result.data.state !== "unknown"
            ? [[prUrls[i], result.data]]
            : [],
        ),
      ),
  });
}

export function usePrDetails(
  prUrl: string | null,
  options?: UsePrDetailsOptions,
) {
  const { includeComments = false } = options ?? {};
  const trpc = useHostTRPC();

  const metaQuery = useQuery({
    ...trpc.git.getPrDetailsByUrl.queryOptions({ prUrl: prUrl as string }),
    enabled: !!prUrl,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
    retry: 1,
  });

  const commentsQuery = useQuery({
    ...trpc.git.getPrReviewComments.queryOptions({ prUrl: prUrl as string }),
    enabled: !!prUrl && includeComments,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 1,
    structuralSharing: true,
  });

  const commentThreads = useMemo(
    () => threadsToMap(commentsQuery.data ?? []),
    [commentsQuery.data],
  );

  return {
    meta: {
      state: metaQuery.data?.state ?? null,
      merged: metaQuery.data?.merged ?? false,
      draft: metaQuery.data?.draft ?? false,
      headRefName: metaQuery.data?.headRefName ?? null,
      isLoading: metaQuery.isLoading,
    },
    commentThreads,
  };
}
