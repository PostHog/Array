import { useTRPC } from "@renderer/trpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useCallback } from "react";

export function useUsage({ enabled = true }: { enabled?: boolean } = {}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const query = useQuery({
    ...trpc.usageMonitor.getLatest.queryOptions(),
    enabled,
  });
  const { mutateAsync: refreshUsage } = useMutation(
    trpc.usageMonitor.refresh.mutationOptions(),
  );

  useSubscription(
    trpc.usageMonitor.onUsageUpdated.subscriptionOptions(undefined, {
      enabled,
      onData: (data) => {
        queryClient.setQueryData(trpc.usageMonitor.getLatest.queryKey(), data);
      },
    }),
  );

  const refetch = useCallback(async () => {
    const fresh = await refreshUsage();
    if (fresh) {
      queryClient.setQueryData(trpc.usageMonitor.getLatest.queryKey(), fresh);
    }
    return fresh;
  }, [refreshUsage, queryClient, trpc.usageMonitor.getLatest]);

  return {
    usage: query.data ?? null,
    isLoading: query.isLoading,
    refetch,
  };
}
