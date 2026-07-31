import type {
  McpGatewayServer,
  McpGatewayServerUpdate,
  McpRecommendedServer,
} from "@posthog/api-client/posthog-client";
import {
  installCustomWithOAuth,
  installTemplateWithOAuth,
  reauthorizeWithOAuth,
} from "@posthog/core/mcp-servers/installFlow";
import { useHostTRPC, useHostTRPCClient } from "@posthog/host-router/react";
import { gatewayKeys } from "@posthog/ui/features/mcp-gateway/hooks/gatewayKeys";
import {
  createOAuthCallback,
  mcpKeys,
} from "@posthog/ui/features/mcp-server-manager/useMcpConnect";
import { useAuthenticatedMutation } from "@posthog/ui/hooks/useAuthenticatedMutation";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { toast } from "@posthog/ui/primitives/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useCallback, useMemo } from "react";

/**
 * The team's gateway server registry plus every server-level mutation:
 * connect/disconnect the caller's own credential, the member self-switch, and
 * the admin controls (team enable, personal connections, remove).
 */
export function useGatewayServers() {
  const trpc = useHostTRPC();
  const trpcClient = useHostTRPCClient();
  const oauth = useMemo(() => createOAuthCallback(trpcClient), [trpcClient]);
  const queryClient = useQueryClient();

  const { data: servers, isLoading: serversLoading } = useAuthenticatedQuery(
    gatewayKeys.servers,
    (client) => client.getMcpGatewayServers(),
  );

  // Catalog templates, only to resolve brand icon domains for gateway rows.
  const { data: templates } = useAuthenticatedQuery(mcpKeys.servers, (client) =>
    client.getMcpServers(),
  );
  const templatesById = useMemo(() => {
    const map = new Map<string, McpRecommendedServer>();
    for (const template of templates ?? []) map.set(template.id, template);
    return map;
  }, [templates]);

  const invalidateServers = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: gatewayKeys.servers });
    // Connections are installation rows, so the legacy surfaces change too.
    queryClient.invalidateQueries({ queryKey: mcpKeys.installations });
  }, [queryClient]);

  const connectMutation = useAuthenticatedMutation(
    (client, server: McpGatewayServer) =>
      server.template_id
        ? installTemplateWithOAuth(client, oauth, {
            template_id: server.template_id,
          })
        : installCustomWithOAuth(client, oauth, {
            name: server.name,
            url: server.url,
            description: server.description,
            auth_type: "oauth",
          }),
    {
      onSuccess: (data, server) => {
        if (data && "success" in data && data.success) {
          toast.success(`Authenticated with ${server.name} as you`);
        } else if (data && "error" in data && data.error) {
          toast.error(data.error);
        }
        invalidateServers();
      },
      onError: (error: Error, server) => {
        toast.error(error.message || `Could not connect to ${server.name}`);
        invalidateServers();
      },
    },
  );

  const reconnectMutation = useAuthenticatedMutation(
    (client, vars: { installationId: string; serverName: string }) =>
      reauthorizeWithOAuth(client, oauth, vars.installationId),
    {
      onSuccess: (data, vars) => {
        if (data && "success" in data && data.success) {
          toast.success(`Authenticated with ${vars.serverName} as you`);
        } else if (data && "error" in data && data.error) {
          toast.error(data.error);
        }
        invalidateServers();
      },
      onError: (error: Error) =>
        toast.error(error.message || "Failed to reconnect"),
    },
  );

  const disconnectMutation = useAuthenticatedMutation(
    (client, vars: { installationId: string; serverName: string }) =>
      client.uninstallMcpServer(vars.installationId),
    {
      onSuccess: (_data, vars) => {
        toast.info(`Disconnected from ${vars.serverName}`);
        invalidateServers();
      },
      onError: (error: Error) =>
        toast.error(error.message || "Failed to disconnect"),
    },
  );

  // Member self-switch on their own connection ("Disabled for you").
  const toggleYourConnectionMutation = useAuthenticatedMutation(
    (client, vars: { installationId: string; enabled: boolean }) =>
      client.updateMcpServerInstallation(vars.installationId, {
        is_enabled: vars.enabled,
      }),
    {
      onSuccess: invalidateServers,
      onError: (error: Error) =>
        toast.error(error.message || "Failed to update server"),
    },
  );

  const updateServerMutation = useAuthenticatedMutation(
    (client, vars: { serverId: string; updates: McpGatewayServerUpdate }) =>
      client.updateMcpGatewayServer(vars.serverId, vars.updates),
    {
      onSuccess: invalidateServers,
      onError: (error: Error) =>
        toast.error(error.message || "Failed to update server"),
    },
  );

  const setAllEnabledMutation = useAuthenticatedMutation(
    async (client, enabled: boolean) => {
      const targets = (servers ?? []).filter(
        (server) => server.is_team_enabled !== enabled,
      );
      await Promise.all(
        targets.map((server) =>
          client.updateMcpGatewayServer(server.id, {
            is_team_enabled: enabled,
          }),
        ),
      );
      return enabled;
    },
    {
      onSuccess: (enabled) => {
        invalidateServers();
        if (enabled) {
          toast.success("Every server is enabled for the team");
        } else {
          toast.info("All servers disabled — enable them one by one");
        }
      },
      onError: (error: Error) =>
        toast.error(error.message || "Failed to update servers"),
    },
  );

  const removeServerMutation = useAuthenticatedMutation(
    (client, vars: { serverId: string; serverName: string }) =>
      client.deleteMcpGatewayServer(vars.serverId),
    {
      onSuccess: (_data, vars) => {
        toast.info(`${vars.serverName} removed from the gateway`);
        invalidateServers();
      },
      onError: (error: Error) =>
        toast.error(error.message || "Failed to remove server"),
    },
  );

  useSubscription(
    trpc.mcpCallback.onOAuthComplete.subscriptionOptions(undefined, {
      onData: (data) => {
        if (data.status === "success") invalidateServers();
      },
    }),
  );

  return {
    servers: servers ?? [],
    serversLoading,
    templatesById,
    invalidateServers,
    connect: connectMutation.mutate,
    connectingServerId: connectMutation.isPending
      ? (connectMutation.variables?.id ?? null)
      : null,
    reconnect: reconnectMutation.mutate,
    reconnectPending: reconnectMutation.isPending,
    disconnect: disconnectMutation.mutate,
    toggleYourConnection: toggleYourConnectionMutation.mutate,
    updateServer: updateServerMutation.mutate,
    setAllEnabled: setAllEnabledMutation.mutate,
    removeServer: removeServerMutation.mutate,
  };
}
