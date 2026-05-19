import { useAuthenticatedMutation } from "@hooks/useAuthenticatedMutation";
import { useAuthenticatedQuery } from "@hooks/useAuthenticatedQuery";
import type {
  McpApprovalState,
  McpInstallationTool,
} from "@renderer/api/posthogClient";
import { useTRPC } from "@renderer/trpc/client";
import { useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { dispatchBulkApproval } from "./mcpToolBulk";
import { mcpKeys } from "./useMcpServers";

interface UseMcpInstallationToolsOptions {
  includeRemoved?: boolean;
  autoRefreshIfEmpty?: boolean;
}

// Module-scoped on purpose: state must survive remounts of this hook so a
// detail-page revisit doesn't re-fire the auto-refresh. Tests that exercise
// auto-refresh need to clear this in beforeEach.
const autoRefreshedInstallations = new Set<string>();

export function useMcpInstallationTools(
  installationId: string | null,
  options: UseMcpInstallationToolsOptions = {},
) {
  const trpcReact = useTRPC();
  const queryClient = useQueryClient();

  const queryKey = [
    ...mcpKeys.tools(installationId ?? ""),
    { includeRemoved: !!options.includeRemoved },
  ] as const;

  const { data: tools, isLoading } = useAuthenticatedQuery(
    queryKey,
    (client) =>
      installationId
        ? client.getMcpInstallationTools(installationId, {
            includeRemoved: options.includeRemoved,
          })
        : Promise.resolve([] as McpInstallationTool[]),
    {
      enabled: !!installationId,
      refetchOnMount: "always",
    },
  );

  const invalidate = useCallback(() => {
    if (!installationId) return;
    queryClient.invalidateQueries({
      queryKey: mcpKeys.tools(installationId),
    });
  }, [installationId, queryClient]);

  const setToolApprovalMutation = useAuthenticatedMutation(
    (client, vars: { toolName: string; approval_state: McpApprovalState }) => {
      if (!installationId) {
        return Promise.reject(new Error("No installation selected"));
      }
      return client.updateMcpToolApproval(
        installationId,
        vars.toolName,
        vars.approval_state,
      );
    },
    {
      onSuccess: () => {
        invalidate();
      },
      onError: (error: Error) => {
        toast.error(error.message || "Failed to update tool approval");
      },
    },
  );

  const setBulkApprovalMutation = useAuthenticatedMutation(
    (
      client,
      vars: {
        approval_state: McpApprovalState;
        targetTools?: McpInstallationTool[];
      },
    ) => {
      if (!installationId) {
        return Promise.reject(new Error("No installation selected"));
      }
      return dispatchBulkApproval(
        client,
        installationId,
        vars.targetTools ?? tools ?? [],
        vars.approval_state,
      );
    },
    {
      onSuccess: () => {
        invalidate();
      },
      onError: (error: Error) => {
        toast.error(error.message || "Failed to update tool approvals");
      },
    },
  );

  const silentRefreshRef = useRef(false);

  const refreshMutation = useAuthenticatedMutation(
    (client) => {
      if (!installationId) {
        return Promise.reject(new Error("No installation selected"));
      }
      return client.refreshMcpInstallationTools(installationId);
    },
    {
      onSuccess: () => {
        const silent = silentRefreshRef.current;
        silentRefreshRef.current = false;
        if (!silent) toast.success("Tools refreshed");
        invalidate();
        queryClient.invalidateQueries({ queryKey: mcpKeys.installations });
      },
      onError: (error: Error) => {
        const silent = silentRefreshRef.current;
        silentRefreshRef.current = false;
        if (!silent) toast.error(error.message || "Failed to refresh tools");
      },
    },
  );

  const toolsLength = (tools ?? []).length;
  const refreshIsPending = refreshMutation.isPending;
  const refreshMutate = refreshMutation.mutate;

  // Auto-fire the same call as the manual Refresh button when the detail
  // panel opens to a freshly-connected installation that hasn't synced its
  // tools yet. The guards exist because each one stops a different misfire:
  //   - autoRefreshIfEmpty: opt-in; only the detail view passes it
  //   - installationId:     nothing to refresh without one
  //   - isLoading:          tools query hasn't settled — wait, we don't
  //                         know yet whether it's empty
  //   - toolsLength > 0:    tools already synced; no refresh needed
  //   - autoRefreshedInstallations.has(...): already auto-refreshed this
  //                         installation in this session — don't re-fire
  //                         on every revisit (covers genuinely-empty
  //                         servers too)
  //   - refreshIsPending:   refresh already in flight (e.g. user clicked
  //                         the manual button in the same render cycle)
  useEffect(() => {
    if (!options.autoRefreshIfEmpty) return;
    if (!installationId) return;
    if (isLoading) return;
    if (toolsLength > 0) return;
    if (autoRefreshedInstallations.has(installationId)) return;
    if (refreshIsPending) return;
    autoRefreshedInstallations.add(installationId);
    silentRefreshRef.current = true;
    refreshMutate(undefined);
  }, [
    options.autoRefreshIfEmpty,
    installationId,
    isLoading,
    toolsLength,
    refreshIsPending,
    refreshMutate,
  ]);

  useSubscription(
    trpcReact.mcpCallback.onOAuthComplete.subscriptionOptions(undefined, {
      onData: (data) => {
        if (data.status === "success") {
          invalidate();
        }
      },
    }),
  );

  return {
    tools: tools ?? [],
    isLoading,
    setToolApproval: setToolApprovalMutation.mutate,
    setBulkApproval: (
      approval_state: McpApprovalState,
      targetTools?: McpInstallationTool[],
    ) => setBulkApprovalMutation.mutate({ approval_state, targetTools }),
    bulkPending: setBulkApprovalMutation.isPending,
    refresh: () => refreshMutation.mutate(undefined),
    refreshPending: refreshMutation.isPending,
  };
}
