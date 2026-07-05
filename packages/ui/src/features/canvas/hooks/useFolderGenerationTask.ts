import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

// The task generating a channel's CONTEXT.md is stored server-side (keyed on the
// folder), so it's shared across everyone in the project — any user sees an
// in-progress generation and won't double-start it. Mirrors the
// useFolderInstructions query/mutation shape.

const GENERATION_TASK_QUERY_KEY = (folderId: string) =>
  ["folder-generation-task", folderId] as const;

export function useFolderGenerationTask(
  folderId: string | null,
  options?: { enabled?: boolean; refetchInterval?: number | false },
) {
  return useAuthenticatedQuery<string | null>(
    folderId
      ? GENERATION_TASK_QUERY_KEY(folderId)
      : (["folder-generation-task", "none"] as const),
    async (client) => {
      if (!folderId) return null;
      return client.getDesktopFolderGenerationTask(folderId);
    },
    {
      enabled: Boolean(folderId) && (options?.enabled ?? true),
      staleTime: 0,
      refetchInterval: options?.refetchInterval ?? false,
    },
  );
}

// set(taskId) records the generating task; set(null) clears it. Best-effort:
// callers should not block generation on this (the backend endpoint may not
// exist yet, in which case the client no-ops on 404).
export function useFolderGenerationTaskMutation(folderId: string | null) {
  const client = useOptionalAuthenticatedClient();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (taskId: string | null) => {
      if (!client || !folderId) return;
      await client.setDesktopFolderGenerationTask(folderId, taskId);
    },
    onSuccess: () => {
      if (!folderId) return;
      void queryClient.invalidateQueries({
        queryKey: GENERATION_TASK_QUERY_KEY(folderId),
      });
    },
  });

  const set = useCallback(
    (taskId: string | null) => mutation.mutateAsync(taskId),
    [mutation],
  );

  return { set };
}
