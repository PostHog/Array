import { useTRPC } from "@renderer/trpc";
import { useQuery } from "@tanstack/react-query";

// Single-query window into the persisted WorkflowConfig. Subscription updates
// write back through the same query key (features/home/subscriptions.ts).
export function useWorkflow() {
  const trpc = useTRPC();
  const query = useQuery(trpc.workflow.get.queryOptions());
  return {
    workflow: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
