import type { RepositoryConfig } from "@shared/types";
import { useAuthStore } from "@stores/authStore";
import { useQuery } from "@tanstack/react-query";
import { formatRepoKey } from "@utils/repository";
import { useMemo } from "react";

interface Integration {
  id: number;
  kind: string;
  [key: string]: unknown;
}

const integrationKeys = {
  all: ["integrations"] as const,
  list: () => [...integrationKeys.all, "list"] as const,
  repositories: (integrationId?: number) =>
    [...integrationKeys.all, "repositories", integrationId] as const,
};

export function useIntegrations() {
  const client = useAuthStore((state) => state.client);

  return useQuery({
    queryKey: integrationKeys.list(),
    queryFn: async () => {
      if (!client) throw new Error("Not authenticated");
      return (await client.getIntegrations()) as Integration[];
    },
    enabled: !!client,
  });
}

function useRepositories(integrationId?: number) {
  const client = useAuthStore((state) => state.client);

  return useQuery({
    queryKey: integrationKeys.repositories(integrationId),
    queryFn: async () => {
      if (!client) throw new Error("Not authenticated");
      if (!integrationId) return [];
      return (await client.getGithubRepositories(
        integrationId,
      )) as RepositoryConfig[];
    },
    enabled: !!client && !!integrationId,
  });
}

export function useRepositoryIntegration() {
  const { data: integrations = [] } = useIntegrations();

  const githubIntegration = useMemo(
    () => integrations.find((i) => i.kind === "github"),
    [integrations],
  );

  const { data: repositories = [] } = useRepositories(githubIntegration?.id);

  const isRepoInIntegration = useMemo(
    () => (repoKey: string) => {
      if (!repoKey) return true;
      return repositories.some(
        (r) => formatRepoKey(r.organization, r.repository) === repoKey,
      );
    },
    [repositories],
  );

  return {
    githubIntegration,
    repositories,
    isRepoInIntegration,
  };
}
