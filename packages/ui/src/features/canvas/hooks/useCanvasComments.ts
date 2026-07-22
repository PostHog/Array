import type { CanvasCommentThread } from "@posthog/core/canvas/canvasCommentsSchemas";
import {
  CANVAS_COMMENTS_SERVICE,
  type CanvasCommentsService,
} from "@posthog/core/canvas/canvasCommentsService";
import type { CommentAnchor } from "@posthog/core/canvas/htmlCanvasSchemas";
import { useService } from "@posthog/di/react";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { useMutation, useQueryClient } from "@tanstack/react-query";

// Multi-user sync is poll-based (no realtime channel exists); matches the
// channel feed's cadence.
const CANVAS_COMMENTS_POLL_INTERVAL_MS = 15_000;

export function canvasCommentsQueryKey(dashboardId: string | undefined) {
  return ["canvas-comments", dashboardId ?? "none"] as const;
}

export function useCanvasComments(dashboardId: string | undefined): {
  threads: CanvasCommentThread[];
  isLoading: boolean;
} {
  const service = useService<CanvasCommentsService>(CANVAS_COMMENTS_SERVICE);
  const query = useAuthenticatedQuery<CanvasCommentThread[]>(
    canvasCommentsQueryKey(dashboardId),
    (client) => service.listThreads(client, dashboardId as string),
    {
      enabled: !!dashboardId,
      refetchInterval: CANVAS_COMMENTS_POLL_INTERVAL_MS,
      staleTime: CANVAS_COMMENTS_POLL_INTERVAL_MS,
    },
  );
  return { threads: query.data ?? [], isLoading: query.isLoading };
}

export function useAddCanvasComment(dashboardId: string | undefined) {
  const client = useOptionalAuthenticatedClient();
  const queryClient = useQueryClient();
  const service = useService<CanvasCommentsService>(CANVAS_COMMENTS_SERVICE);
  const mutation = useMutation({
    mutationFn: async (input: {
      content: string;
      anchor: CommentAnchor;
      canvasVersionId?: string;
    }) => {
      if (!client || !dashboardId) throw new Error("Not authenticated");
      return service.addComment(client, { dashboardId, ...input });
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: canvasCommentsQueryKey(dashboardId),
      }),
  });
  return { addComment: mutation.mutateAsync, isAdding: mutation.isPending };
}

export function useAddCanvasReply(dashboardId: string | undefined) {
  const client = useOptionalAuthenticatedClient();
  const queryClient = useQueryClient();
  const service = useService<CanvasCommentsService>(CANVAS_COMMENTS_SERVICE);
  const mutation = useMutation({
    mutationFn: async (input: { content: string; rootId: string }) => {
      if (!client || !dashboardId) throw new Error("Not authenticated");
      return service.addReply(client, { dashboardId, ...input });
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: canvasCommentsQueryKey(dashboardId),
      }),
  });
  return { addReply: mutation.mutateAsync, isReplying: mutation.isPending };
}

export function useRemoveCanvasComment(dashboardId: string | undefined) {
  const client = useOptionalAuthenticatedClient();
  const queryClient = useQueryClient();
  const service = useService<CanvasCommentsService>(CANVAS_COMMENTS_SERVICE);
  const mutation = useMutation({
    mutationFn: async (commentId: string) => {
      if (!client) throw new Error("Not authenticated");
      return service.remove(client, commentId);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: canvasCommentsQueryKey(dashboardId),
      }),
  });
  return { removeComment: mutation.mutateAsync };
}
