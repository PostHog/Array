import type { ScoutScratchpadEntry } from "@posthog/api-client/posthog-client";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { useAuthStateValue } from "../../auth/store";
import { scoutQueryKeys } from "./scoutQueryKeys";

/**
 * Recent fleet scratchpad memory. The endpoint has no per-run filter, so
 * run-detail views select entries by `created_by_run_id` client-side. Reads
 * and upsert-updates are not attributed to runs server-side yet (scouts-ui
 * api gap 6), so this only ever reveals entries a run CREATED.
 */
export function useScoutScratchpad() {
  const projectId = useAuthStateValue((state) => state.currentProjectId);
  return useAuthenticatedQuery<ScoutScratchpadEntry[]>(
    scoutQueryKeys.scratchpad(projectId),
    (client) =>
      projectId
        ? client.searchScoutScratchpad(projectId, { limit: 100 })
        : Promise.resolve([]),
    { enabled: !!projectId, staleTime: 60_000 },
  );
}
