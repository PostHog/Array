import type { ScoutEmissionReportLink } from "@posthog/api-client/posthog-client";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { useAuthStateValue } from "../../auth/store";
import { scoutQueryKeys } from "./scoutQueryKeys";

/**
 * Best-effort reverse lookup of which inbox report each of a run's findings
 * grouped into. Loaded per run alongside {@link useScoutRunEmissions}; the
 * caller keys the result by `source_id` to adorn each emission card.
 */
export function useScoutEmissionReports(runId: string) {
  const projectId = useAuthStateValue((state) => state.currentProjectId);
  return useAuthenticatedQuery<ScoutEmissionReportLink[]>(
    scoutQueryKeys.emissionReports(projectId, runId),
    (client) =>
      projectId
        ? client.listScoutEmissionReports(projectId, runId)
        : Promise.resolve([]),
    {
      enabled: !!projectId && !!runId,
      staleTime: 60_000,
    },
  );
}
