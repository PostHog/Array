import type {
  McpPolicyPreset,
  TeamMcpGatewayConfigUpdate,
} from "@posthog/api-client/posthog-client";
import { gatewayKeys } from "@posthog/ui/features/mcp-gateway/hooks/gatewayKeys";
import { useAuthenticatedMutation } from "@posthog/ui/hooks/useAuthenticatedMutation";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { toast } from "@posthog/ui/primitives/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/** Team gateway settings plus the caller's role, with the admin mutations. */
export function useGatewayConfig() {
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useAuthenticatedQuery(
    gatewayKeys.config,
    (client) => client.getMcpGatewayConfig(),
  );

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: gatewayKeys.config });
  }, [queryClient]);

  const updateSettingsMutation = useAuthenticatedMutation(
    (client, update: TeamMcpGatewayConfigUpdate) =>
      client.updateMcpGatewaySettings(update),
    {
      onSuccess: invalidate,
      onError: (error: Error) =>
        toast.error(error.message || "Failed to update gateway settings"),
    },
  );

  const applyPresetMutation = useAuthenticatedMutation(
    (
      client,
      vars: { audience: "members" | "agents"; preset: McpPolicyPreset },
    ) => client.applyMcpGatewayPreset(vars),
    {
      onSuccess: () => {
        invalidate();
        // Presets rewrite scope policies, so any open tool list is stale.
        queryClient.invalidateQueries({ queryKey: gatewayKeys.servers });
      },
      onError: (error: Error) =>
        toast.error(error.message || "Failed to apply policy baseline"),
    },
  );

  return {
    config,
    configLoading: isLoading,
    isAdmin: config?.is_admin ?? false,
    allowCustomServers: config?.allow_custom_servers ?? true,
    allowMemberAgentAccess: config?.allow_member_agent_access ?? true,
    canManageAgentAccess:
      (config?.is_admin ?? false) ||
      (config?.allow_member_agent_access ?? true),
    updateSettings: updateSettingsMutation.mutate,
    applyPreset: applyPresetMutation.mutate,
    applyPresetPending: applyPresetMutation.isPending,
  };
}
