import {
  getOptimisticPrState,
  PR_ACTION_LABELS,
} from "@posthog/core/git-interaction/prStatus";
import { useHostTRPC } from "@posthog/host-router/react";
import type { PrActionType } from "@posthog/shared";
import { showOfflineToast } from "@posthog/ui/features/connectivity/connectivityToast";
import { useConnectivity } from "@posthog/ui/hooks/useConnectivity";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "../../primitives/toast";

export function usePrActions(prUrl: string | null) {
  const trpc = useHostTRPC();
  const queryClient = useQueryClient();
  const { isOnline } = useConnectivity();

  const mutation = useMutation({
    ...trpc.git.updatePrByUrl.mutationOptions(),
    onSuccess: (data, variables) => {
      if (data.success) {
        toast.success(PR_ACTION_LABELS[variables.action]);
        queryClient.setQueryData(
          trpc.git.getPrDetailsByUrl.queryKey({ prUrl: variables.prUrl }),
          (prev) => ({
            ...getOptimisticPrState(variables.action),
            headRefName: prev?.headRefName ?? null,
            title: prev?.title ?? null,
          }),
        );
        // The inbox Pulls list reads PR status from the batched
        // `getPrDiffStatsBatch` query (separate cache, 5-min staleTime), so
        // patching the detail cache above isn't enough — invalidate the batch
        // so the list badge reflects the new state on next view.
        void queryClient.invalidateQueries(
          trpc.git.getPrDiffStatsBatch.pathFilter(),
        );

        // Merge-queue submit/cancel change queue status, not the PR lifecycle.
        // Patch the queue-status cache optimistically so the badge flips
        // immediately, then invalidate so the next poll reconciles with Trunk.
        if (variables.action === "merge-queue") {
          queryClient.setQueryData(
            trpc.git.getPrMergeQueueStatus.queryKey({
              prUrl: variables.prUrl,
            }),
            () => ({
              status: "queued" as const,
              conclusion: null,
              detailsUrl: null,
              name: "Trunk Merge Queue",
            }),
          );
        } else if (variables.action === "merge-queue-cancel") {
          queryClient.setQueryData(
            trpc.git.getPrMergeQueueStatus.queryKey({
              prUrl: variables.prUrl,
            }),
            () => null,
          );
        }
        if (
          variables.action === "merge-queue" ||
          variables.action === "merge-queue-cancel"
        ) {
          void queryClient.invalidateQueries(
            trpc.git.getPrMergeQueueStatus.pathFilter(),
          );
        }
      } else {
        toast.error("Failed to update PR", { description: data.message });
      }
    },
    onError: (error) => {
      toast.error("Failed to update PR", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    },
  });

  return {
    execute: (action: PrActionType) => {
      if (!prUrl) return;
      if (!isOnline) {
        showOfflineToast();
        return;
      }
      mutation.mutate({ prUrl, action });
    },
    isPending: mutation.isPending,
  };
}
