import {
  getOptimisticPrState,
  PR_ACTION_LABELS,
} from "@posthog/core/git-interaction/prStatus";
import { useHostTRPC } from "@posthog/host-router/react";
import type { PrActionType } from "@posthog/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "../../primitives/toast";

export function usePrActions(prUrl: string | null) {
  const trpc = useHostTRPC();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    ...trpc.git.updatePrByUrl.mutationOptions(),
    onSuccess: (data, variables) => {
      if (data.success) {
        toast.success(PR_ACTION_LABELS[variables.action]);
        queryClient.setQueryData(
          trpc.git.getPrDetailsByUrl.queryKey({ prUrl: variables.prUrl }),
          getOptimisticPrState(variables.action),
        );
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
      mutation.mutate({ prUrl, action });
    },
    isPending: mutation.isPending,
  };
}
