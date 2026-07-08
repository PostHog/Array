import { type LoopSchemas, listLoops } from "@posthog/api-client/loops";
import { AUTH_SCOPED_QUERY_META } from "@posthog/ui/features/auth/useCurrentUser";
import { useQuery } from "@tanstack/react-query";
import { loopsKeys } from "./loopsKeys";
import { useLoopsClient } from "./useLoopsClient";

const LOOPS_LIST_LIMIT = 100;

export function useLoops() {
  const loopsClient = useLoopsClient();

  return useQuery<LoopSchemas.Loop[]>({
    queryKey: loopsKeys.list(loopsClient?.projectId ?? null),
    queryFn: async () => {
      if (!loopsClient) throw new Error("Not authenticated");
      const page = await listLoops(loopsClient.client, loopsClient.projectId, {
        limit: LOOPS_LIST_LIMIT,
      });
      return page.results;
    },
    enabled: !!loopsClient,
    staleTime: 30_000,
    meta: AUTH_SCOPED_QUERY_META,
  });
}
