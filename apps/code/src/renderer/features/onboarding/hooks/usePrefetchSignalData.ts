import { useOptionalAuthenticatedClient } from "@features/auth/hooks/authClient";
import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

/**
 * Prefetches onboarding step data so GitHub and Signals steps load instantly.
 * Call this early in the onboarding flow (e.g. in OnboardingFlow component).
 */
export function usePrefetchSignalData(): void {
  const client = useOptionalAuthenticatedClient();
  const projectId = useAuthStateValue((state) => state.projectId);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!client || !projectId) return;

    queryClient.prefetchQuery({
      queryKey: ["integrations", projectId],
      queryFn: () => client.getIntegrationsForProject(projectId),
      staleTime: 60_000,
    });

    queryClient.prefetchQuery({
      queryKey: ["signals", "source-configs", projectId],
      queryFn: () => client.listSignalSourceConfigs(projectId),
      staleTime: 30_000,
    });

    queryClient.prefetchQuery({
      queryKey: ["external-data-sources", projectId],
      queryFn: () => client.listExternalDataSources(projectId),
      staleTime: 60_000,
    });

    queryClient.prefetchQuery({
      queryKey: ["integrations", "list"],
      queryFn: async () => {
        const integrations = await client.getIntegrations("github");
        const ghIntegration = (
          integrations as { id: number; kind: string }[]
        ).find((i) => i.kind === "github");
        if (ghIntegration) {
          queryClient.prefetchQuery({
            queryKey: ["integrations", "repositories", ghIntegration.id],
            queryFn: () => client.getGithubRepositories(ghIntegration.id),
            staleTime: 60_000,
          });
        }
        return integrations;
      },
      staleTime: 60_000,
    });
  }, [client, projectId, queryClient]);
}
