import { useAuthenticatedQuery } from "@hooks/useAuthenticatedQuery";
import type { SlackChannelsResponse } from "@shared/types";

export function useSlackChannels(integrationId: number | null | undefined) {
  return useAuthenticatedQuery<SlackChannelsResponse>(
    ["slack", "channels", integrationId ?? null],
    async (client) => {
      if (!integrationId) {
        return { channels: [] };
      }
      return await client.getSlackChannelsForIntegration(integrationId);
    },
    {
      enabled: !!integrationId,
      // Slack channel lists are cached server-side for an hour, so refresh
      // sparingly on the client.
      staleTime: 5 * 60_000,
    },
  );
}
