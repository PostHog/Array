import { useTRPC } from "@renderer/trpc";
import {
  EMPTY_HOME_SNAPSHOT,
  type HomeSnapshot,
} from "@shared/types/home-snapshot";
import { useQuery } from "@tanstack/react-query";

// Single-query window into the server-computed Home snapshot. Grouping, PR
// polling, and classification all run server-side (PostHog's
// evaluate-code-workstreams worker); the subscription registrar keeps this
// query fresh (features/home/subscriptions.ts).
export function useHomeSnapshot(): {
  snapshot: HomeSnapshot;
  isLoading: boolean;
} {
  const trpc = useTRPC();
  const query = useQuery(trpc.home.getSnapshot.queryOptions());
  return {
    snapshot: query.data ?? EMPTY_HOME_SNAPSHOT,
    isLoading: query.isLoading,
  };
}
