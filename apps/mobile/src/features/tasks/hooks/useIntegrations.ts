import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/features/auth";
import { getGithubRepositories, getIntegrations } from "../api";
import { buildRepositoryOptions } from "../utils/repositorySelection";

export const integrationKeys = {
  all: ["integrations"] as const,
  lists: () => [...integrationKeys.all, "list"] as const,
  github: () => [...integrationKeys.all, "github"] as const,
  repos: (integrationId: number) =>
    [...integrationKeys.all, "repos", integrationId] as const,
};

interface RepositoryLoadResult {
  repositoriesByIntegration: Record<number, string[]>;
  partialError: string | null;
}

interface UseIntegrationsOptions {
  enabled?: boolean;
}

export function useIntegrations(options: UseIntegrationsOptions = {}) {
  const { enabled = true } = options;
  const { projectId, oauthAccessToken } = useAuthStore();

  const integrationsQuery = useQuery({
    queryKey: integrationKeys.github(),
    queryFn: async () => {
      const data = await getIntegrations();
      return data.filter((i) => i.kind === "github");
    },
    enabled: enabled && !!projectId && !!oauthAccessToken,
  });

  const githubIntegrations = enabled ? (integrationsQuery.data ?? []) : [];

  const repositoriesQuery = useQuery({
    queryKey: [
      ...integrationKeys.all,
      "repos",
      githubIntegrations.map((i) => i.id),
    ],
    queryFn: async (): Promise<RepositoryLoadResult> => {
      const repositoriesByIntegration: Record<number, string[]> = {};
      const results = await Promise.allSettled(
        githubIntegrations.map(async (integration) => ({
          integrationId: integration.id,
          repositories: await getGithubRepositories(integration.id),
        })),
      );

      let failedCount = 0;

      for (const result of results) {
        if (result.status === "fulfilled") {
          repositoriesByIntegration[result.value.integrationId] =
            result.value.repositories;
          continue;
        }

        failedCount += 1;
      }

      return {
        repositoriesByIntegration,
        partialError:
          failedCount === 0
            ? null
            : failedCount === githubIntegrations.length
              ? "Could not load GitHub repositories. Pull to retry."
              : "Some GitHub repositories could not be loaded. Pull to retry.",
      };
    },
    enabled: enabled && githubIntegrations.length > 0,
  });

  const repositoriesByIntegration =
    repositoriesQuery.data?.repositoriesByIntegration ?? {};
  const repositories = Object.values(repositoriesByIntegration).flat().sort();
  const repositoryOptions = buildRepositoryOptions(
    githubIntegrations,
    repositoriesByIntegration,
  );
  const repositoryWarning = repositoriesQuery.data?.partialError ?? null;

  const refetch = async () => {
    if (!enabled) {
      return;
    }

    await integrationsQuery.refetch();
    await repositoriesQuery.refetch();
  };

  return {
    hasGithubIntegration: !enabled
      ? null
      : integrationsQuery.isFetched
        ? githubIntegrations.length > 0
        : null,
    githubIntegrations,
    repositories,
    repositoriesByIntegration,
    repositoryOptions,
    isLoading: enabled
      ? integrationsQuery.isLoading || repositoriesQuery.isLoading
      : false,
    error: enabled ? (integrationsQuery.error?.message ?? null) : null,
    repositoryWarning: enabled ? repositoryWarning : null,
    refetch,
  };
}
