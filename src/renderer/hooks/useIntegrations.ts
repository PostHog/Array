import { useAuthStore } from "@features/auth/stores/authStore";
import {
  useIntegrationSelectors,
  useIntegrationStore,
} from "@features/integrations/stores/integrationStore";
import type { RepositoryConfig } from "@shared/types";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

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
  const setIntegrations = useIntegrationStore((state) => state.setIntegrations);

  const query = useQuery({
    queryKey: integrationKeys.list(),
    queryFn: async () => {
      if (!client) throw new Error("Not authenticated");
      return (await client.getIntegrations()) as Integration[];
    },
    enabled: !!client,
  });

  useEffect(() => {
    if (query.data) {
      setIntegrations(query.data);
    }
  }, [query.data, setIntegrations]);

  return query;
}

function useRepositories(integrationId?: number) {
  const client = useAuthStore((state) => state.client);
  const setRepositories = useIntegrationStore((state) => state.setRepositories);

  const query = useQuery({
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

  useEffect(() => {
    if (query.data) {
      setRepositories(query.data);
    }
  }, [query.data, setRepositories]);

  return query;
}

export function useRepositoryIntegration() {
  useIntegrations();
  const { githubIntegration } = useIntegrationSelectors();
  useRepositories(githubIntegration?.id);

  const repositories = useIntegrationStore((state) => state.repositories);
  const { isRepoInIntegration } = useIntegrationSelectors();

  return {
    githubIntegration,
    repositories,
    isRepoInIntegration,
  };
}
