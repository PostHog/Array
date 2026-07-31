import { useHostTRPC } from "@posthog/host-router/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/** The saved product environments for a PostHog project (most recent first). */
export function useProductEnvironments(projectId: number | null) {
  const trpc = useHostTRPC();
  return useQuery(
    trpc.productView.listEnvironments.queryOptions(
      { projectId: projectId ?? -1 },
      { enabled: projectId != null },
    ),
  );
}

export function useSaveProductEnvironment() {
  const trpc = useHostTRPC();
  const queryClient = useQueryClient();
  return useMutation(
    trpc.productView.saveEnvironment.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.productView.listEnvironments.queryKey(),
        });
      },
    }),
  );
}

export function useRemoveProductEnvironment() {
  const trpc = useHostTRPC();
  const queryClient = useQueryClient();
  return useMutation(
    trpc.productView.removeEnvironment.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.productView.listEnvironments.queryKey(),
        });
      },
    }),
  );
}

/** Candidate product URLs derived from the project's own PostHog data. */
export function useProductUrlSuggestions(enabled: boolean) {
  const trpc = useHostTRPC();
  return useQuery(
    trpc.productView.suggestUrls.queryOptions(undefined, {
      enabled,
      staleTime: 5 * 60 * 1000,
    }),
  );
}
