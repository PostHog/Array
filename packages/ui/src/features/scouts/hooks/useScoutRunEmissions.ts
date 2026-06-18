import type { ScoutEmission } from "@posthog/api-client/posthog-client";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { useAuthStateValue } from "../../auth/store";
import { scoutQueryKeys } from "./scoutQueryKeys";

export function useScoutRunEmissions(runId: string) {
  const projectId = useAuthStateValue((state) => state.currentProjectId);
  return useAuthenticatedQuery<ScoutEmission[]>(
    scoutQueryKeys.emissions(projectId, runId),
    (client) =>
      projectId
        ? client.listScoutRunEmissions(projectId, runId)
        : Promise.resolve([]),
    {
      enabled: !!projectId && !!runId,
      staleTime: 60_000,
    },
  );
}
