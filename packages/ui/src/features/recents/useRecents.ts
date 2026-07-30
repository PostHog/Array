import type { RecentEngagementInput } from "@posthog/core/recents/schemas";
import { useHostTRPC, useHostTRPCClient } from "@posthog/host-router/react";
import { AUTH_SCOPED_QUERY_META } from "@posthog/ui/features/auth/useCurrentUser";
import { logger } from "@posthog/ui/shell/logger";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

const log = logger.scope("recents");

export function useRecents() {
  const trpc = useHostTRPC();
  return useQuery(
    trpc.recents.list.queryOptions(undefined, {
      meta: AUTH_SCOPED_QUERY_META,
      staleTime: 30_000,
    }),
  );
}

export function useRecordRecentEngagement(): (
  input: RecentEngagementInput,
) => void {
  const trpc = useHostTRPC();
  const client = useHostTRPCClient();
  const queryClient = useQueryClient();
  const { mutate } = useMutation({
    mutationFn: (input: RecentEngagementInput) =>
      client.recents.record.mutate(input),
    onSuccess: () =>
      queryClient.invalidateQueries(trpc.recents.list.pathFilter()),
    onError: (error, input) => {
      log.warn("Failed to record recent engagement", { error, input });
    },
  });
  return useCallback((input: RecentEngagementInput) => mutate(input), [mutate]);
}
