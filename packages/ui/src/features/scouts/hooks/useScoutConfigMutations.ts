import type { ScoutConfig } from "@posthog/api-client/posthog-client";
import { useAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import { useAuthStateValue } from "../../auth/store";
import { scoutQueryKeys } from "./scoutQueryKeys";

export interface ScoutConfigUpdate {
  enabled?: boolean;
  emit?: boolean;
  run_interval_minutes?: number;
}

/**
 * Optimistically patch a scout config (enable/disable, live vs dry-run,
 * cadence) and reconcile with the server response.
 */
export function useScoutConfigMutations() {
  const client = useAuthenticatedClient();
  const queryClient = useQueryClient();
  const projectId = useAuthStateValue((state) => state.currentProjectId);

  const updateConfig = useCallback(
    async (configId: string, updates: ScoutConfigUpdate) => {
      if (!client || !projectId) return;
      const queryKey = scoutQueryKeys.configs(projectId);
      const previous = queryClient.getQueryData<ScoutConfig[]>(queryKey);
      queryClient.setQueryData<ScoutConfig[]>(queryKey, (configs) =>
        configs?.map((config) =>
          config.id === configId ? { ...config, ...updates } : config,
        ),
      );
      try {
        const updated = await client.updateScoutConfig(
          projectId,
          configId,
          updates,
        );
        queryClient.setQueryData<ScoutConfig[]>(queryKey, (configs) =>
          configs?.map((config) => (config.id === configId ? updated : config)),
        );
      } catch (error: unknown) {
        queryClient.setQueryData(queryKey, previous);
        const message =
          error instanceof Error
            ? error.message
            : "Failed to update scout config";
        toast.error(message);
      }
    },
    [client, projectId, queryClient],
  );

  return { updateConfig };
}
