import type {
  CreateResourceCommentRequest,
  ResourceComment,
} from "@posthog/api-client/posthog-client";
import type { CommentTarget } from "@posthog/core/comments/anchors";
import {
  SESSION_SERVICE,
  type SessionService,
} from "@posthog/core/sessions/sessionService";
import { useService } from "@posthog/di/react";
import {
  getAuthIdentity,
  useAuthStateValue,
} from "@posthog/ui/features/auth/store";
import { AUTH_SCOPED_QUERY_META } from "@posthog/ui/features/auth/useCurrentUser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function commentsQueryKey(
  authIdentity: string | null,
  target: CommentTarget | null,
) {
  return [
    "comments",
    authIdentity,
    target?.scope ?? "",
    target?.itemId ?? "",
  ] as const;
}

export function useCommentsQuery(
  target: CommentTarget | null,
  options: { live?: boolean } = {},
) {
  const service = useService<SessionService>(SESSION_SERVICE);
  const authIdentity = useAuthStateValue(getAuthIdentity);
  return useQuery({
    queryKey: commentsQueryKey(authIdentity, target),
    queryFn: () =>
      target ? service.getResourceComments(target) : Promise.resolve([]),
    enabled: authIdentity !== null && !!target,
    staleTime: 3_000,
    refetchInterval: options.live === false ? false : 5_000,
    refetchIntervalInBackground: false,
    meta: AUTH_SCOPED_QUERY_META,
  });
}

/**
 * One query for every comment across a set of resources. The service does the
 * fan-out, so this stays a single-query hook and the pane makes one request
 * instead of one per row. `live: false` by default — a list of N resources must
 * never turn into N polling loops.
 */
export function useCommentsForTargetsQuery(
  targets: CommentTarget[],
  options: { live?: boolean } = {},
) {
  const service = useService<SessionService>(SESSION_SERVICE);
  const authIdentity = useAuthStateValue(getAuthIdentity);
  // Sorted so key identity tracks the set, not row order.
  const key = targets
    .map((target) => `${target.scope}:${target.itemId}`)
    .sort()
    .join(",");
  return useQuery({
    queryKey: ["comments", "targets", authIdentity, key] as const,
    queryFn: () => service.getResourceCommentsForTargets(targets),
    enabled: authIdentity !== null && targets.length > 0,
    staleTime: 3_000,
    refetchInterval: options.live ? 5_000 : false,
    refetchIntervalInBackground: false,
    meta: AUTH_SCOPED_QUERY_META,
  });
}

export function useCreateComment(target: CommentTarget) {
  const service = useService<SessionService>(SESSION_SERVICE);
  const authIdentity = useAuthStateValue(getAuthIdentity);
  const queryClient = useQueryClient();
  const queryKey = commentsQueryKey(authIdentity, target);

  return useMutation({
    mutationFn: (
      request: Omit<CreateResourceCommentRequest, "scope" | "itemId">,
    ) => service.createResourceComment({ ...request, ...target }),
    onMutate: async (request) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ResourceComment[]>(queryKey);
      const optimistic: ResourceComment = {
        id: `optimistic-${crypto.randomUUID()}`,
        created_by: null,
        content: request.content,
        created_at: new Date().toISOString(),
        item_id: target.itemId,
        item_context: request.context,
        scope: target.scope,
        source_comment: request.sourceCommentId ?? null,
        completed_at: null,
      };
      queryClient.setQueryData<ResourceComment[]>(queryKey, [
        ...(previous ?? []),
        optimistic,
      ]);
      return { previous };
    },
    onError: (_error, _request, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
}

export function useSetCommentResolved(target: CommentTarget) {
  const service = useService<SessionService>(SESSION_SERVICE);
  const authIdentity = useAuthStateValue(getAuthIdentity);
  const queryClient = useQueryClient();
  const queryKey = commentsQueryKey(authIdentity, target);

  return useMutation({
    mutationFn: ({
      root,
      resolved,
    }: {
      root: ResourceComment;
      resolved: boolean;
    }) => {
      const rootContext =
        root.item_context && typeof root.item_context === "object"
          ? root.item_context
          : {};
      return service.createResourceComment({
        ...target,
        content: resolved ? "Resolved this thread" : "Reopened this thread",
        sourceCommentId: root.id,
        context: {
          ...rootContext,
          threadState: resolved ? "resolved" : "open",
        },
      });
    },
    onMutate: async ({ root, resolved }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ResourceComment[]>(queryKey);
      const rootContext =
        root.item_context && typeof root.item_context === "object"
          ? root.item_context
          : {};
      const optimistic: ResourceComment = {
        id: `optimistic-state-${crypto.randomUUID()}`,
        created_by: null,
        content: resolved ? "Resolved this thread" : "Reopened this thread",
        created_at: new Date().toISOString(),
        item_id: target.itemId,
        item_context: {
          ...rootContext,
          threadState: resolved ? "resolved" : "open",
        },
        scope: target.scope,
        source_comment: root.id,
        completed_at: null,
      };
      queryClient.setQueryData<ResourceComment[]>(queryKey, [
        ...(previous ?? []),
        optimistic,
      ]);
      return { previous };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
}
