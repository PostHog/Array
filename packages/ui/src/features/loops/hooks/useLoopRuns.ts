import { type LoopSchemas, listLoopRuns } from "@posthog/api-client/loops";
import { AUTH_SCOPED_QUERY_META } from "@posthog/ui/features/auth/useCurrentUser";
import { useInfiniteQuery } from "@tanstack/react-query";
import { loopsKeys } from "./loopsKeys";
import { useLoopsClient } from "./useLoopsClient";

const LOOP_RUNS_PAGE_LIMIT = 20;

export function useLoopRuns(loopId: string | undefined) {
  const loopsClient = useLoopsClient();

  return useInfiniteQuery<LoopSchemas.LoopRunPage>({
    queryKey: loopsKeys.runs(loopsClient?.projectId ?? null, loopId ?? ""),
    queryFn: async ({ pageParam }) => {
      if (!loopsClient || !loopId) throw new Error("Not authenticated");
      return await listLoopRuns(
        loopsClient.client,
        loopsClient.projectId,
        loopId,
        {
          limit: LOOP_RUNS_PAGE_LIMIT,
          cursor: pageParam as string | undefined,
        },
      );
    },
    enabled: !!loopsClient && !!loopId,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    staleTime: 15_000,
    meta: AUTH_SCOPED_QUERY_META,
  });
}
