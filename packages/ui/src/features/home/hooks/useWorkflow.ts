import {
  type SaveInput,
  type SaveResult,
  saveResult,
  type WorkflowConfig,
  workflowConfig,
} from "@posthog/core/workflow/schemas";
import { useAuthenticatedMutation } from "@posthog/ui/hooks/useAuthenticatedMutation";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { useQueryClient } from "@tanstack/react-query";
import { homeKeys } from "./useHomeSnapshot";

// Single-query window into the persisted WorkflowConfig. The save and reset
// mutations write back through the same query key.
export function useWorkflow() {
  const query = useAuthenticatedQuery(homeKeys.workflow, async (client) =>
    workflowConfig.parse(await client.getCodeWorkflow()),
  );
  return {
    workflow: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useSaveWorkflowMutation() {
  const queryClient = useQueryClient();
  return useAuthenticatedMutation<SaveResult, Error, SaveInput>(
    async (client, input) =>
      saveResult.parse(
        await client.saveCodeWorkflow({
          config: input.config,
          expectedVersion: input.expectedVersion,
        }),
      ),
    {
      onSuccess: (result) => {
        if (result.status === "saved") {
          queryClient.setQueryData(homeKeys.workflow, result.config);
        }
      },
    },
  );
}

export function useResetWorkflowMutation() {
  const queryClient = useQueryClient();
  return useAuthenticatedMutation<WorkflowConfig, Error, void>(
    async (client) => workflowConfig.parse(await client.resetCodeWorkflow()),
    {
      onSuccess: (config) => {
        queryClient.setQueryData(homeKeys.workflow, config);
      },
    },
  );
}
