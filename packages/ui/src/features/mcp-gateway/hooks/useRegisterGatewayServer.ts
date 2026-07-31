import type { McpGatewayServer } from "@posthog/api-client/posthog-client";
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

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

interface RegisterGatewayServerResult {
  /** The gateway registration for the just-added server, when resolvable. */
  created: McpGatewayServer | null;
  error: string | null;
}

/**
 * Registers a custom server with the gateway (Add-server form submit) and
 * resolves the resulting registry entry so the caller can navigate to it.
 */
export function useRegisterGatewayServer() {
  const trpcClient = useHostTRPCClient();
  const oauth = useMemo(() => createOAuthCallback(trpcClient), [trpcClient]);
  const queryClient = useQueryClient();

  const mutation = useAuthenticatedMutation(
    async (
      client,
      vars: { request: GatewayInstallRequest },
    ): Promise<RegisterGatewayServerResult> => {
      const result = await registerGatewayServerWithOAuth(
        client,
        oauth,
        vars.request,
      );
      if (result?.error) {
        return { created: null, error: result.error };
      }
      // Re-read the registry to find the registration for the new server —
      // the gateway keys servers by (team, url).
      const servers = await client.getMcpGatewayServers();
      queryClient.setQueryData(gatewayKeys.servers, servers);
      const target = normalizeUrl(vars.request.url);
      return {
        created:
          servers.find((server) => normalizeUrl(server.url) === target) ?? null,
        error: null,
      };
    },
    {
      onSuccess: (data, vars) => {
        if (data.error) {
          toast.error(data.error);
        } else {
          toast.success(`${vars.request.name} added to the gateway`);
        }
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
