import type {
  McpServiceAccountStatus,
  McpServiceAccountWithToken,
  McpToolPolicyEntry,
} from "@posthog/api-client/posthog-client";
import { gatewayKeys } from "@posthog/ui/features/mcp-gateway/hooks/gatewayKeys";
import { useAuthenticatedMutation } from "@posthog/ui/hooks/useAuthenticatedMutation";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { toast } from "@posthog/ui/primitives/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

/**
 * Agent service accounts and their mutations. Freshly-issued tokens (creation
 * or rotation) surface once via `newToken` and are discarded on dismiss.
 */
export function useServiceAccounts() {
  const queryClient = useQueryClient();
  const [newToken, setNewToken] = useState<McpServiceAccountWithToken | null>(
    null,
  );

  const { data: accounts, isLoading } = useAuthenticatedQuery(
    gatewayKeys.accounts,
    (client) => client.getMcpServiceAccounts(),
  );

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: gatewayKeys.accounts });
    queryClient.invalidateQueries({ queryKey: gatewayKeys.servers });
  }, [queryClient]);

  const createMutation = useAuthenticatedMutation(
    (client, vars: { name: string; description?: string }) =>
      client.createMcpServiceAccount(vars),
    {
      onSuccess: (account) => {
        invalidate();
        setNewToken(account);
        toast.success(`${account.name} created — share servers with it`);
      },
      onError: (error: Error) =>
        toast.error(error.message || "Failed to create agent"),
    },
  );

  const setStatusMutation = useAuthenticatedMutation(
    (
      client,
      vars: {
        accountId: string;
        name: string;
        status: McpServiceAccountStatus;
      },
    ) =>
      client.updateMcpServiceAccount(vars.accountId, { status: vars.status }),
    {
      onSuccess: (_account, vars) => {
        invalidate();
        if (vars.status === "paused") {
          toast.info(`${vars.name} paused — all access is off`);
        } else {
          toast.success(`${vars.name} is active again`);
        }
      },
      onError: (error: Error) =>
        toast.error(error.message || "Failed to update agent"),
    },
  );

  const deleteMutation = useAuthenticatedMutation(
    (client, vars: { accountId: string; name: string }) =>
      client.deleteMcpServiceAccount(vars.accountId),
    {
      onSuccess: (_data, vars) => {
        invalidate();
        toast.info(`${vars.name} deleted — its token no longer works`);
      },
      onError: (error: Error) =>
        toast.error(error.message || "Failed to delete agent"),
    },
  );

  const rotateTokenMutation = useAuthenticatedMutation(
    (client, accountId: string) =>
      client.rotateMcpServiceAccountToken(accountId),
    {
      onSuccess: (account) => {
        invalidate();
        setNewToken(account);
        toast.success("Token rotated — the previous token no longer works");
      },
      onError: (error: Error) =>
        toast.error(error.message || "Failed to rotate token"),
    },
  );

  const setAccessMutation = useAuthenticatedMutation(
    (
      client,
      vars: {
        accountId: string;
        serverId: string;
        enabled: boolean;
        policies?: McpToolPolicyEntry[];
        /** Toast copy, e.g. "Support can now use Linear". */
        successMessage?: string;
      },
    ) =>
      client.setMcpServiceAccountAccess(vars.accountId, {
        gateway_server_id: vars.serverId,
        enabled: vars.enabled,
        ...(vars.policies ? { policies: vars.policies } : {}),
      }),
    {
      onSuccess: (_account, vars) => {
        invalidate();
        if (vars.successMessage) {
          if (vars.enabled) toast.success(vars.successMessage);
          else toast.info(vars.successMessage);
        }
      },
      onError: (error: Error) =>
        toast.error(error.message || "Failed to update agent access"),
    },
  );

  return {
    accounts: accounts ?? [],
    accountsLoading: isLoading,
    createAccount: createMutation.mutate,
    createPending: createMutation.isPending,
    setStatus: setStatusMutation.mutate,
    deleteAccount: deleteMutation.mutate,
    rotateToken: rotateTokenMutation.mutate,
    rotatePending: rotateTokenMutation.isPending,
    setAccess: setAccessMutation.mutate,
    setAccessPending: setAccessMutation.isPending,
    newToken,
    dismissNewToken: () => setNewToken(null),
  };
}
