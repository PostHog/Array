import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import { useAuthenticatedQuery } from "@hooks/useAuthenticatedQuery";
import type { SignalSourceConfig } from "@renderer/api/posthogClient";

export function useSignalSourceConfigs() {
  const projectId = useAuthStateValue((state) => state.currentProjectId);
  return useAuthenticatedQuery<SignalSourceConfig[]>(
    ["signals", "source-configs", projectId],
    (client) =>
      projectId
        ? client.listSignalSourceConfigs(projectId)
        : Promise.resolve([]),
    { enabled: !!projectId, staleTime: 30_000 },
  );
}
