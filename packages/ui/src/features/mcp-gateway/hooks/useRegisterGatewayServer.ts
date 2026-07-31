import type { GatewayInstallRequest } from "@posthog/core/mcp-gateway/gatewayAddServer";
import { registerGatewayServerWithOAuth } from "@posthog/core/mcp-gateway/gatewayInstallFlow";
import { useHostTRPCClient } from "@posthog/host-router/react";
import { gatewayKeys } from "@posthog/ui/features/mcp-gateway/hooks/gatewayKeys";
import {
  createOAuthCallback,
  mcpKeys,
} from "@posthog/ui/features/mcp-server-manager/useMcpConnect";
import { useAuthenticatedMutation } from "@posthog/ui/hooks/useAuthenticatedMutation";
import { toast } from "@posthog/ui/primitives/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

/** Registers a custom server with the gateway (Add-server form submit). */
export function useRegisterGatewayServer() {
  const trpcClient = useHostTRPCClient();
  const oauth = useMemo(() => createOAuthCallback(trpcClient), [trpcClient]);
  const queryClient = useQueryClient();

  const mutation = useAuthenticatedMutation(
    (client, vars: { request: GatewayInstallRequest }) =>
      registerGatewayServerWithOAuth(client, oauth, vars.request),
    {
      onSuccess: (data, vars) => {
        if (data && "error" in data && data.error) {
          toast.error(data.error);
        } else {
          toast.success(`${vars.request.name} added to the gateway`);
        }
        queryClient.invalidateQueries({ queryKey: gatewayKeys.servers });
        queryClient.invalidateQueries({ queryKey: mcpKeys.installations });
      },
      onError: (error: Error) =>
        toast.error(error.message || "Failed to add server"),
    },
  );

  return {
    register: mutation.mutate,
    registerPending: mutation.isPending,
  };
}
