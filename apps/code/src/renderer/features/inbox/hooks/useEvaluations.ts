import { useAuthStore } from "@features/auth/stores/authStore";
import { useAuthenticatedQuery } from "@hooks/useAuthenticatedQuery";
import type { Evaluation } from "@renderer/api/posthogClient";

const POLL_INTERVAL_MS = 5_000;

export function useEvaluations() {
  const projectId = useAuthStore((s) => s.currentProjectId);
  return useAuthenticatedQuery<Evaluation[]>(
    ["evaluations", projectId],
    (client) =>
      projectId ? client.listEvaluations(projectId) : Promise.resolve([]),
    {
      enabled: !!projectId,
      staleTime: POLL_INTERVAL_MS,
      refetchInterval: POLL_INTERVAL_MS,
    },
  );
}
