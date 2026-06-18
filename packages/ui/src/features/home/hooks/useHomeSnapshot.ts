import {
  EMPTY_HOME_SNAPSHOT,
  type HomeSnapshot,
  homeSnapshot,
} from "@posthog/core/home/schemas";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";

export const homeKeys = {
  snapshot: ["home", "snapshot"] as const,
  workflow: ["home", "workflow"] as const,
};

const POLL_INTERVAL_MS = 120_000;

// Single-query window into the server-computed Home snapshot. Grouping, PR
// polling, and classification all run server-side (PostHog's
// evaluate-code-workstreams worker); the poll interval keeps this query fresh.
export function useHomeSnapshot(): {
  snapshot: HomeSnapshot;
  isLoading: boolean;
} {
  const query = useAuthenticatedQuery(
    homeKeys.snapshot,
    async (client) => homeSnapshot.parse(await client.getHomeSnapshot()),
    { refetchInterval: POLL_INTERVAL_MS },
  );
  return {
    snapshot: query.data ?? EMPTY_HOME_SNAPSHOT,
    isLoading: query.isLoading,
  };
}
