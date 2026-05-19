import { useAuthenticatedMutation } from "@hooks/useAuthenticatedMutation";
import { useAuthenticatedQuery } from "@hooks/useAuthenticatedQuery";
import type {
  McpAuthType,
  McpRecommendedServer,
  McpServerInstallation,
  PostHogAPIClient,
} from "@renderer/api/posthogClient";
import { trpcClient, useTRPC } from "@renderer/trpc/client";
import { useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

export const mcpKeys = {
  servers: ["mcp", "servers"] as const,
  installations: ["mcp", "installations"] as const,
  tools: (installationId: string) =>
    ["mcp", "installations", installationId, "tools"] as const,
};

/**
 * Run the OAuth install flow for an MCP server.
 * Gets callback URL, calls the API, and (if a redirect_url comes back) opens the
 * browser and waits for the callback.
 */
async function runOAuthInstall(
  redirectUrl: string,
): Promise<{ success?: boolean; error?: string }> {
  return trpcClient.mcpCallback.openAndWaitForCallback.mutate({ redirectUrl });
}

async function getCallbackUrl(): Promise<string> {
  const { callbackUrl } = await trpcClient.mcpCallback.getCallbackUrl.query();
  return callbackUrl;
}

async function installTemplateWithOAuth(
  client: PostHogAPIClient,
  vars: { template_id: string; api_key?: string },
) {
  const callbackUrl = await getCallbackUrl();
  const data = await client.installMcpTemplate({
    ...vars,
    install_source: "posthog-code",
    posthog_code_callback_url: callbackUrl,
  });
  if ("redirect_url" in data && data.redirect_url) {
    return runOAuthInstall(data.redirect_url);
  }
  return { success: true };
}

async function installCustomWithOAuth(
  client: PostHogAPIClient,
  vars: {
    name: string;
    url: string;
    description: string;
    auth_type: McpAuthType;
    api_key?: string;
    client_id?: string;
    client_secret?: string;
  },
) {
  const callbackUrl = await getCallbackUrl();
  const data = await client.installCustomMcpServer({
    ...vars,
    install_source: "posthog-code",
    posthog_code_callback_url: callbackUrl,
  });
  if ("redirect_url" in data && data.redirect_url) {
    return runOAuthInstall(data.redirect_url);
  }
  return { success: true };
}

export { filterServersByCategory, filterServersByQuery } from "./mcpFilters";

export function useMcpServers() {
  const trpcReact = useTRPC();
  const [installingId, setInstallingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: installations, isLoading: installationsLoading } =
    useAuthenticatedQuery(mcpKeys.installations, (client) =>
      client.getMcpServerInstallations(),
    );

  const { data: servers, isLoading: serversLoading } = useAuthenticatedQuery(
    mcpKeys.servers,
    (client) => client.getMcpServers(),
  );

  const installedTemplateIds = useMemo(
    () =>
      new Set(
        (installations ?? [])
          .map((i) => i.template_id)
          .filter((id): id is string => !!id),
      ),
    [installations],
  );

  const installedUrls = useMemo(
    () =>
      new Set(
        (installations ?? []).map((i) => i.url).filter((u): u is string => !!u),
      ),
    [installations],
  );

  const invalidateInstallations = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: mcpKeys.installations });
  }, [queryClient]);

  const uninstallMutation = useAuthenticatedMutation(
    (client, installationId: string) =>
      client.uninstallMcpServer(installationId),
    {
      onSuccess: () => {
        toast.success("Server uninstalled");
        invalidateInstallations();
      },
      onError: (error: Error) => {
        toast.error(error.message || "Failed to uninstall server");
      },
    },
  );

  const toggleEnabledMutation = useAuthenticatedMutation(
    (client, vars: { id: string; is_enabled: boolean }) =>
      client.updateMcpServerInstallation(vars.id, {
        is_enabled: vars.is_enabled,
      }),
    {
      onSuccess: () => {
        invalidateInstallations();
      },
      onError: (error: Error) => {
        toast.error(error.message || "Failed to update server");
      },
    },
  );

  const toggleEnabled = useCallback(
    (installationId: string, enabled: boolean) => {
      toggleEnabledMutation.mutate({ id: installationId, is_enabled: enabled });
    },
    [toggleEnabledMutation],
  );

  const installTemplateMutation = useAuthenticatedMutation(
    (client, vars: { template_id: string; api_key?: string }) =>
      installTemplateWithOAuth(client, vars),
    {
      onSuccess: (data) => {
        if (data && "success" in data && data.success) {
          toast.success("Server connected");
        } else if (data && "error" in data && data.error) {
          toast.error(data.error);
        }
        invalidateInstallations();
        setInstallingId(null);
      },
      onError: (error: Error) => {
        toast.error(error.message || "Failed to connect server");
        setInstallingId(null);
      },
    },
  );

  const installTemplate = useCallback(
    (template: McpRecommendedServer, opts?: { api_key?: string }) => {
      setInstallingId(template.id);
      installTemplateMutation.mutate({
        template_id: template.id,
        api_key: opts?.api_key,
      });
    },
    [installTemplateMutation],
  );

  const installCustomMutation = useAuthenticatedMutation(
    (
      client,
      vars: {
        name: string;
        url: string;
        description: string;
        auth_type: McpAuthType;
        api_key?: string;
        client_id?: string;
        client_secret?: string;
      },
    ) => installCustomWithOAuth(client, vars),
    {
      onSuccess: (data) => {
        if (data && "success" in data && data.success) {
          toast.success("Server added");
        } else if (data && "error" in data && data.error) {
          toast.error(data.error);
        }
        invalidateInstallations();
      },
      onError: (error: Error) => {
        toast.error(error.message || "Failed to add server");
      },
    },
  );

  const reauthorizeMutation = useAuthenticatedMutation(
    async (client, installationId: string) => {
      const callbackUrl = await getCallbackUrl();
      const data = await client.authorizeMcpInstallation({
        installation_id: installationId,
        install_source: "posthog-code",
        posthog_code_callback_url: callbackUrl,
      });
      return runOAuthInstall(data.redirect_url);
    },
    {
      onSuccess: (data) => {
        if (data && "success" in data && data.success) {
          toast.success("Server reconnected");
        } else if (data && "error" in data && data.error) {
          toast.error(data.error);
        }
        invalidateInstallations();
      },
      onError: (error: Error) => {
        toast.error(error.message || "Failed to reconnect server");
      },
    },
  );

  useSubscription(
    trpcReact.mcpCallback.onOAuthComplete.subscriptionOptions(undefined, {
      onData: (data) => {
        if (data.status === "success") {
          invalidateInstallations();
        }
      },
    }),
  );

  return {
    installations: installations as McpServerInstallation[] | undefined,
    installationsLoading,
    servers: servers as McpRecommendedServer[] | undefined,
    serversLoading,
    installedTemplateIds,
    installedUrls,
    installingId,
    uninstallMutation,
    toggleEnabled,
    installTemplate,
    installCustom: installCustomMutation.mutate,
    installCustomPending: installCustomMutation.isPending,
    reauthorize: reauthorizeMutation.mutate,
    reauthorizePending: reauthorizeMutation.isPending,
    invalidateInstallations,
  };
}
