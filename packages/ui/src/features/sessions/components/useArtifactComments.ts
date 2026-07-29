import type {
  ArtifactComment,
  CreateArtifactCommentRequest,
} from "@posthog/api-client/posthog-client";
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

export function artifactCommentsQueryKey(
  authIdentity: string | null,
  artifactId: string,
) {
  return ["artifactComments", authIdentity, artifactId] as const;
}

export function useArtifactCommentsQuery(
  artifactId: string | null,
  options: { live?: boolean } = {},
) {
  const service = useService<SessionService>(SESSION_SERVICE);
  const authIdentity = useAuthStateValue(getAuthIdentity);
  return useQuery({
    queryKey: artifactCommentsQueryKey(authIdentity, artifactId ?? ""),
    queryFn: () => service.getArtifactComments(artifactId ?? ""),
    enabled: authIdentity !== null && !!artifactId,
    staleTime: 3_000,
    refetchInterval: options.live === false ? false : 5_000,
    refetchIntervalInBackground: false,
    meta: AUTH_SCOPED_QUERY_META,
  });
}

export function useCreateArtifactComment(artifactId: string) {
  const service = useService<SessionService>(SESSION_SERVICE);
  const authIdentity = useAuthStateValue(getAuthIdentity);
  const queryClient = useQueryClient();
  const queryKey = artifactCommentsQueryKey(authIdentity, artifactId);

  return useMutation({
    mutationFn: (request: Omit<CreateArtifactCommentRequest, "artifactId">) =>
      service.createArtifactComment({ ...request, artifactId }),
    onMutate: async (request) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ArtifactComment[]>(queryKey);
      const optimistic: ArtifactComment = {
        id: `optimistic-${crypto.randomUUID()}`,
        created_by: null,
        content: request.content,
        created_at: new Date().toISOString(),
        item_id: artifactId,
        item_context: request.context,
        scope: "task_artifact",
        source_comment: request.sourceCommentId ?? null,
        completed_at: null,
      };
      queryClient.setQueryData<ArtifactComment[]>(queryKey, [
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

export function useSetArtifactCommentResolved(artifactId: string) {
  const service = useService<SessionService>(SESSION_SERVICE);
  const authIdentity = useAuthStateValue(getAuthIdentity);
  const queryClient = useQueryClient();
  const queryKey = artifactCommentsQueryKey(authIdentity, artifactId);

  return useMutation({
    mutationFn: ({
      root,
      resolved,
    }: {
      root: ArtifactComment;
      resolved: boolean;
    }) => {
      const rootContext =
        root.item_context && typeof root.item_context === "object"
          ? root.item_context
          : {};
      return service.createArtifactComment({
        artifactId,
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
      const previous = queryClient.getQueryData<ArtifactComment[]>(queryKey);
      const rootContext =
        root.item_context && typeof root.item_context === "object"
          ? root.item_context
          : {};
      const optimistic: ArtifactComment = {
        id: `optimistic-state-${crypto.randomUUID()}`,
        created_by: null,
        content: resolved ? "Resolved this thread" : "Reopened this thread",
        created_at: new Date().toISOString(),
        item_id: artifactId,
        item_context: {
          ...rootContext,
          threadState: resolved ? "resolved" : "open",
        },
        scope: "task_artifact",
        source_comment: root.id,
        completed_at: null,
      };
      queryClient.setQueryData<ArtifactComment[]>(queryKey, [
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
