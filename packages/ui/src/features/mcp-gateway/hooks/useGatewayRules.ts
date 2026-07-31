import { gatewayKeys } from "@posthog/ui/features/mcp-gateway/hooks/gatewayKeys";
import { useAuthenticatedMutation } from "@posthog/ui/hooks/useAuthenticatedMutation";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { toast } from "@posthog/ui/primitives/toast";
import { useQueryClient } from "@tanstack/react-query";

/** Team-wide guardrail rules and the enable/disable toggle. */
export function useGatewayRules(options: { enabled: boolean }) {
  const queryClient = useQueryClient();

  const { data: rules, isLoading } = useAuthenticatedQuery(
    gatewayKeys.rules,
    (client) => client.getMcpGatewayRules(),
    { enabled: options.enabled },
  );

  const toggleRuleMutation = useAuthenticatedMutation(
    (client, vars: { ruleId: string; name: string; enabled: boolean }) =>
      client.updateMcpGatewayRule(vars.ruleId, { enabled: vars.enabled }),
    {
      onSuccess: (_rule, vars) => {
        queryClient.invalidateQueries({ queryKey: gatewayKeys.rules });
        // Rule changes re-resolve every tool list.
        queryClient.invalidateQueries({ queryKey: gatewayKeys.servers });
        if (vars.enabled) toast.success(`${vars.name} enabled`);
        else toast.info(`${vars.name} disabled`);
      },
      onError: (error: Error) =>
        toast.error(error.message || "Failed to update rule"),
    },
  );

  return {
    rules: rules ?? [],
    rulesLoading: isLoading,
    toggleRule: toggleRuleMutation.mutate,
  };
}
