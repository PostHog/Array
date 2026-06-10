import type { ScoutRun } from "@posthog/api-client/posthog-client";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStateValue } from "../../auth/store";
import { scoutQueryKeys } from "./scoutQueryKeys";

export function useScoutRun(runId: string) {
  const projectId = useAuthStateValue((state) => state.currentProjectId);
  const queryClient = useQueryClient();
  return useAuthenticatedQuery<ScoutRun | null>(
    scoutQueryKeys.run(projectId, runId),
    (client) =>
      projectId ? client.getScoutRun(projectId, runId) : Promise.resolve(null),
    {
      enabled: !!projectId && !!runId,
      staleTime: 15_000,
      initialData: () =>
        queryClient
          .getQueryData<ScoutRun[]>(scoutQueryKeys.runs(projectId))
          ?.find((run) => run.run_id === runId) ?? undefined,
    },
  );
}
