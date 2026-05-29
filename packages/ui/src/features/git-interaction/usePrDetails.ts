import { useHostTRPC } from "@posthog/host-router/react";
import type { PrReviewThread } from "@posthog/shared";
import { useQuery } from "@tanstack/react-query";
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
      isLoading: metaQuery.isLoading,
    },
    commentThreads,
  };
}
