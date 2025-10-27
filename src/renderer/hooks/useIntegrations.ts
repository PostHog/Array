import {
  useIntegrationSelectors,
  useIntegrationStore,
} from "@features/integrations/stores/integrationStore";
import type { RepositoryConfig } from "@shared/types";
import { useEffect } from "react";
import { useAuthenticatedQuery } from "./useAuthenticatedQuery";

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
  const setIntegrations = useIntegrationStore((state) => state.setIntegrations);

  const query = useAuthenticatedQuery(
    integrationKeys.list(),
    (client) => client.getIntegrations() as Promise<Integration[]>,
  );

  useEffect(() => {
    if (query.data) {
      setIntegrations(query.data);
    }
  }, [query.data, setIntegrations]);

  return query;
}

function useRepositories(integrationId?: number) {
  const setRepositories = useIntegrationStore((state) => state.setRepositories);

  const query = useAuthenticatedQuery(
    integrationKeys.repositories(integrationId),
    async (client) => {
      if (!integrationId) return [];
      return (await client.getGithubRepositories(
        integrationId,
      )) as RepositoryConfig[];
    },
  );

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
