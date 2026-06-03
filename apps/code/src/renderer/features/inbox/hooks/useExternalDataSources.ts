import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import { useAuthenticatedQuery } from "@hooks/useAuthenticatedQuery";
import type { ExternalDataSource } from "@renderer/api/posthogClient";

export function useExternalDataSources() {
  const projectId = useAuthStateValue((state) => state.currentProjectId);
  return useAuthenticatedQuery<ExternalDataSource[]>(
    ["external-data-sources", projectId],
    (client) =>
      projectId
        ? client.listExternalDataSources(projectId)
        : Promise.resolve([]),
    { enabled: !!projectId, staleTime: 60_000 },
  );
}
