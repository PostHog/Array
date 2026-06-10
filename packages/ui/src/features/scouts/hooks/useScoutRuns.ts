import type { ScoutRun } from "@posthog/api-client/posthog-client";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { useAuthStateValue } from "../../auth/store";
import { scoutQueryKeys } from "./scoutQueryKeys";

/**
 * The most recent fleet-wide scout runs (newest first). The backend caps this
 * list at 100 rows and has no per-scout filter yet (scouts-ui api gap 1), so
 * per-scout views filter this window client-side. Stats derived from it
 * describe the visible window, not all time.
 */
export function useScoutRuns() {
  const projectId = useAuthStateValue((state) => state.currentProjectId);
  return useAuthenticatedQuery<ScoutRun[]>(
    scoutQueryKeys.runs(projectId),
    (client) =>
      projectId
        ? client.listScoutRuns(projectId, { limit: 100 })
        : Promise.resolve([]),
    {
      enabled: !!projectId,
      staleTime: 15_000,
      refetchInterval: 60_000,
    },
  );
}
