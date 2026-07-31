import type {
  McpApprovalState,
  McpResolvedToolPolicy,
} from "@posthog/api-client/posthog-client";
import {
  isAgentPolicyState,
  isPolicyStateAllowedByCeiling,
} from "@posthog/core/mcp-gateway/gatewayServers";
import {
  type GatewayPolicyScope,
  gatewayKeys,
} from "@posthog/ui/features/mcp-gateway/hooks/gatewayKeys";
import { useAuthenticatedMutation } from "@posthog/ui/hooks/useAuthenticatedMutation";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { toast } from "@posthog/ui/primitives/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

function scopeParams(scope: GatewayPolicyScope) {
  return {
    scope_type: scope.scopeType,
    scope_user_id: scope.scopeUserId,
    scope_service_account_id: scope.scopeServiceAccountId,
  };
}

/** Tool catalog of one gateway server, resolved for one policy scope. */
export function useGatewayToolPolicies(
  serverId: string,
  scope: GatewayPolicyScope,
  options: { enabled?: boolean } = {},
) {
  const queryClient = useQueryClient();
  const queryKey = gatewayKeys.tools(serverId, scope);

  const { data: policies, isLoading } = useAuthenticatedQuery(
    queryKey,
    (client) => client.getMcpGatewayToolPolicies(serverId, scopeParams(scope)),
    { enabled: options.enabled ?? true },
  );

  // The upsert responds with the re-resolved catalog, so write it straight
  // into the cache instead of refetching.
  const applyResult = useCallback(
    (result: McpResolvedToolPolicy[]) => {
      queryClient.setQueryData(queryKey, result);
      queryClient.invalidateQueries({
        queryKey: gatewayKeys.serverTools(serverId),
      });
    },
    [queryClient, queryKey, serverId],
  );

  const setPolicyMutation = useAuthenticatedMutation(
    (client, vars: { toolName: string; state: McpApprovalState }) => {
      if (scope.scopeType === "agent" && !isAgentPolicyState(vars.state)) {
        return Promise.reject(
          new Error("Agents cannot use approval-gated tool policies"),
        );
      }
      return client.upsertMcpGatewayToolPolicies(serverId, {
        ...scopeParams(scope),
        policies: [{ tool_name: vars.toolName, policy_state: vars.state }],
      });
    },
    {
      onSuccess: applyResult,
      onError: (error: Error) =>
        toast.error(error.message || "Failed to update tool policy"),
    },
  );

  const setAllMutation = useAuthenticatedMutation(
    (
      client,
      vars: { state: McpApprovalState; toolNames?: readonly string[] },
    ) => {
      if (scope.scopeType === "agent" && !isAgentPolicyState(vars.state)) {
        return Promise.reject(
          new Error("Agents cannot use approval-gated tool policies"),
        );
      }
      const targetNames = vars.toolNames ? new Set(vars.toolNames) : null;
      const editable = (policies ?? []).filter(
        (policy) =>
          !policy.locked &&
          (scope.scopeType === "team" ||
            isPolicyStateAllowedByCeiling(vars.state, policy.team_state)) &&
          (!targetNames || targetNames.has(policy.tool_name)),
      );
      return client.upsertMcpGatewayToolPolicies(serverId, {
        ...scopeParams(scope),
        policies: editable.map((policy) => ({
          tool_name: policy.tool_name,
          policy_state: vars.state,
        })),
      });
    },
    {
      onSuccess: applyResult,
      onError: (error: Error) =>
        toast.error(error.message || "Failed to update tool policies"),
    },
  );

  // Re-lists tools from the upstream server via the caller's installation.
  const refreshMutation = useAuthenticatedMutation(
    (client, installationId: string) =>
      client.refreshMcpInstallationTools(installationId),
    {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: gatewayKeys.serverTools(serverId),
        });
        queryClient.invalidateQueries({ queryKey: gatewayKeys.servers });
      },
      onError: (error: Error) =>
        toast.error(error.message || "Failed to refresh tools"),
    },
  );

  return {
    policies: policies ?? [],
    policiesLoading: isLoading,
    setPolicy: setPolicyMutation.mutate,
    setAll: (state: McpApprovalState, toolNames?: readonly string[]) =>
      setAllMutation.mutate({ state, toolNames }),
    setAllPending: setAllMutation.isPending,
    refresh: refreshMutation.mutate,
    refreshPending: refreshMutation.isPending,
  };
}
