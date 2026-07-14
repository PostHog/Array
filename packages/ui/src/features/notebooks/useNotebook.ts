import { NotebooksService } from "@posthog/core/notebooks/notebooksService";
import { useService } from "@posthog/di/react";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useQuery } from "@tanstack/react-query";

export function useNotebook(shortId: string) {
  const client = useOptionalAuthenticatedClient();
  const service = useService(NotebooksService);

  return useQuery({
    queryKey: ["notebook", shortId],
    queryFn: () => {
      if (!client) throw new Error("Not authenticated");
      return service.getNotebook(client, shortId);
    },
    enabled: client !== null,
    // The editing surface owns the document once loaded; background refetches
    // would fight the sync engine's optimistic-concurrency baseline. Once the
    // editor unmounts the cached copy is dropped immediately (gcTime 0) so
    // reopening always starts from server truth.
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
