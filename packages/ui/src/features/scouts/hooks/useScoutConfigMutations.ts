import type { ScoutConfig } from "@posthog/api-client/posthog-client";
import { getScoutOrigin } from "@posthog/core/scouts/scoutPresentation";
import { ANALYTICS_EVENTS } from "@posthog/shared";
import { useAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { track } from "@posthog/ui/shell/analytics";
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

const CONFIG_SETTINGS = ["enabled", "emit", "run_interval_minutes"] as const;

function trackConfigChange(
  previousConfig: ScoutConfig | undefined,
  updates: ScoutConfigUpdate,
  success: boolean,
): void {
  if (!previousConfig) return;
  for (const setting of CONFIG_SETTINGS) {
    const newValue = updates[setting];
    if (newValue === undefined) continue;
    track(ANALYTICS_EVENTS.SCOUT_CONFIG_CHANGED, {
      skill_name: previousConfig.skill_name,
      scout_origin: getScoutOrigin(previousConfig.skill_name),
      setting,
      new_value: newValue,
      old_value: previousConfig[setting],
      success,
    });
  }
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
      const previousConfig = previous?.find((config) => config.id === configId);
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
        trackConfigChange(previousConfig, updates, true);
      } catch (error: unknown) {
        queryClient.setQueryData(queryKey, previous);
        trackConfigChange(previousConfig, updates, false);
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
