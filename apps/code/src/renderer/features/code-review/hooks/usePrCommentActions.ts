import { useTRPC } from "@renderer/trpc";
import { trpcClient } from "@renderer/trpc/client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";

export function usePrCommentActions(prUrl: string | null) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const reply = useCallback(
    async (commentId: number, body: string): Promise<boolean> => {
      if (!prUrl) return false;
      try {
        const result = await trpcClient.git.replyToPrComment.mutate({
          prUrl,
          commentId,
          body,
        });
        if (!result.success) {
          toast.error("Failed to post reply");
          return false;
        }
        await queryClient.invalidateQueries(
          trpc.git.getPrReviewComments.queryFilter({ prUrl }),
        );
        return true;
      } catch {
        toast.error("Failed to post reply");
        return false;
      }
    },
    [prUrl, queryClient, trpc],
  );

  const resolve = useCallback(
    async (threadNodeId: string, resolved: boolean): Promise<boolean> => {
      if (!prUrl) return false;
      const mutation = resolved
        ? trpcClient.git.resolveReviewThread
        : trpcClient.git.unresolveReviewThread;
      try {
        const result = await mutation.mutate({ prUrl, threadNodeId });
        if (!result.success) {
          toast.error(
            resolved
              ? "Failed to resolve thread"
              : "Failed to unresolve thread",
          );
          return false;
        }
        await queryClient.invalidateQueries(
          trpc.git.getPrReviewComments.queryFilter({ prUrl }),
        );
        return true;
      } catch {
        toast.error(
          resolved ? "Failed to resolve thread" : "Failed to unresolve thread",
        );
        return false;
      }
    },
    [prUrl, queryClient, trpc],
  );

  return { reply, resolve };
}
