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

export function useArtifactCommentsQuery(artifactId: string) {
  const service = useService<SessionService>(SESSION_SERVICE);
  const authIdentity = useAuthStateValue(getAuthIdentity);
  return useQuery({
    queryKey: artifactCommentsQueryKey(authIdentity, artifactId),
    queryFn: () => service.getArtifactComments(artifactId),
    enabled: authIdentity !== null,
    staleTime: 3_000,
    refetchInterval: 5_000,
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
        is_task: !request.sourceCommentId,
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
    mutationFn: ({ id, resolved }: { id: string; resolved: boolean }) =>
      service.setArtifactCommentResolved(id, resolved),
    onMutate: async ({ id, resolved }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ArtifactComment[]>(queryKey);
      queryClient.setQueryData<ArtifactComment[]>(
        queryKey,
        previous?.map((comment) =>
          comment.id === id
            ? {
                ...comment,
                completed_at: resolved ? new Date().toISOString() : null,
              }
            : comment,
        ),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
}
