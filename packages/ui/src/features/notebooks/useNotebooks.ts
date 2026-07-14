import { NotebooksService } from "@posthog/core/notebooks/notebooksService";
import { useService } from "@posthog/di/react";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useQuery } from "@tanstack/react-query";

export const NOTEBOOKS_QUERY_KEY = ["notebooks"] as const;

export function useNotebooks() {
  const client = useOptionalAuthenticatedClient();
  const service = useService(NotebooksService);

  return useQuery({
    queryKey: NOTEBOOKS_QUERY_KEY,
    queryFn: () => {
      if (!client) throw new Error("Not authenticated");
      return service.listNotebooks(client);
    },
    enabled: client !== null,
  });
}
