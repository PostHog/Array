import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useQuery } from "@tanstack/react-query";

export interface EmbedQueryResult<T> {
  data: T | undefined;
  /** Resolved alongside the data — needed for "open in PostHog" links. */
  teamId: number | undefined;
  /** Cloud web-app origin, available as soon as we have a client. */
  appHost: string | null;
  hasClient: boolean;
  isLoading: boolean;
  error: unknown;
}

/**
 * Shared fetch wrapper for notebook entity embeds: authenticated client +
 * TanStack query with the notebook cache policy, resolving the project id
 * alongside the payload so cards can build cloud links.
 */
export function useEmbedQuery<T>(
  keyParts: readonly unknown[],
  fetcher: (client: PostHogAPIClient) => Promise<T>,
  options?: { enabled?: boolean },
): EmbedQueryResult<T> {
  const client = useOptionalAuthenticatedClient();
  const enabled = client !== null && (options?.enabled ?? true);

  const query = useQuery({
    queryKey: ["notebook-embed", ...keyParts],
    queryFn: async (): Promise<{ data: T; teamId: number }> => {
      if (!client) throw new Error("Not authenticated");
      const [data, teamId] = await Promise.all([
        fetcher(client),
        client.getProjectId(),
      ]);
      return { data, teamId };
    },
    enabled,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  return {
    data: query.data?.data,
    teamId: query.data?.teamId,
    appHost: client?.appHost ?? null,
    hasClient: client !== null,
    isLoading: enabled && query.isLoading,
    error: query.error,
  };
}
