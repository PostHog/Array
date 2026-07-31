import { gatewayKeys } from "@posthog/ui/features/mcp-gateway/hooks/gatewayKeys";
import { useAuthenticatedMutation } from "@posthog/ui/hooks/useAuthenticatedMutation";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { toast } from "@posthog/ui/primitives/toast";
import { useQueryClient } from "@tanstack/react-query";

/** Admin overview of members plus the per-member server kill switch. */
export function useGatewayMembers(options: { enabled: boolean }) {
  const queryClient = useQueryClient();

  const { data: members, isLoading } = useAuthenticatedQuery(
    gatewayKeys.members,
    (client) => client.getMcpGatewayMembers(),
    { enabled: options.enabled },
  );

  const setAccessMutation = useAuthenticatedMutation(
    (
      client,
      vars: {
        userId: number;
        serverId: string;
        enabled: boolean;
        /** Toast copy, e.g. "Jonah can now use Forge". */
        successMessage?: string;
      },
    ) =>
      client.setMcpGatewayMemberAccess(vars.userId, {
        gateway_server_id: vars.serverId,
        enabled: vars.enabled,
      }),
    {
      onSuccess: (_data, vars) => {
        queryClient.invalidateQueries({ queryKey: gatewayKeys.members });
        queryClient.invalidateQueries({ queryKey: gatewayKeys.servers });
        if (vars.successMessage) {
          if (vars.enabled) toast.success(vars.successMessage);
          else toast.info(vars.successMessage);
        }
      },
      onError: (error: Error) =>
        toast.error(error.message || "Failed to update member access"),
    },
  );

  return {
    members: members ?? [],
    membersLoading: isLoading,
    setMemberAccess: setAccessMutation.mutate,
  };
}
