import type { RepositoryConfig } from "@shared/types";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "../stores/authStore";

interface Integration {
  id: number;
  kind: string;
  [key: string]: unknown;
}

export const integrationKeys = {
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

export function useRepositories(integrationId?: number) {
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
