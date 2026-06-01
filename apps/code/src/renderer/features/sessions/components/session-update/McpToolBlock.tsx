import { McpAppHost } from "@features/mcp-apps/components/McpAppHost";
import { McpToolView } from "@features/mcp-apps/components/McpToolView";
import { parseMcpToolKey } from "@features/mcp-apps/utils/mcp-app-host-utils";
import { useSettingsStore } from "@features/settings/stores/settingsStore";
import { useTRPC } from "@renderer/trpc/client";
import { POSTHOG_EXEC_TOOL_KEY } from "@shared/types/mcp-apps";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useEffect } from "react";
import type { ToolViewProps } from "./toolCallUtils";

interface McpToolBlockProps extends ToolViewProps {
  mcpToolName: string;
}

export function McpToolBlock(props: McpToolBlockProps) {
  const { mcpToolName, toolCall } = props;
  const { serverName, toolName } = parseMcpToolKey(mcpToolName);

  // PostHog's built-in `exec` tool surfaces UI apps through each call's response
  // `_meta`, so it can't be discovered at registration time like other MCP
  // tools. For it we gate on a per-call lookup instead of the per-tool one.
  const isExec = mcpToolName === POSTHOG_EXEC_TOOL_KEY;
  const toolCallId = toolCall.toolCallId;

  const mcpAppsDisabled = useSettingsStore((s) => s.mcpAppsDisabledServers);
  const isDisabledForServer = mcpAppsDisabled.includes(serverName);
  const enabled = !isDisabledForServer;

  const trpcReact = useTRPC();
  const queryClient = useQueryClient();

  // Registration-discovered tools: a stable per-tool association.
  const { data: hasUiByTool } = useQuery(
    trpcReact.mcpApps.hasUiForTool.queryOptions(
      { toolKey: mcpToolName },
      { staleTime: Infinity, enabled: enabled && !isExec },
    ),
  );

  // `exec` tool: a per-call association resolved once the result arrives.
  const { data: hasUiByCall } = useQuery(
    trpcReact.mcpApps.hasUiForToolCall.queryOptions(
      { toolCallId },
      { staleTime: Infinity, enabled: enabled && isExec },
    ),
  );

  const hasUi = isExec ? hasUiByCall : hasUiByTool;

  // When MCP Apps discovery completes (possibly after this component mounted),
  // invalidate the hasUiForTool query so we pick up newly-discovered UIs.
  useSubscription(
    trpcReact.mcpApps.onDiscoveryComplete.subscriptionOptions(undefined, {
      enabled: enabled && !isExec,
      onData: (_event) => {
        void queryClient.invalidateQueries(
          trpcReact.mcpApps.hasUiForTool.pathFilter(),
        );
        void queryClient.invalidateQueries(
          trpcReact.mcpApps.getUiResource.pathFilter(),
        );
      },
    }),
  );

  // `exec`: a UI app is announced for this specific call once its response
  // `_meta` is parsed in the main process. Refresh the per-call lookups.
  useSubscription(
    trpcReact.mcpApps.onToolCallUiDiscovered.subscriptionOptions(
      { toolCallId },
      {
        enabled: enabled && isExec,
        onData: (_event) => {
          void queryClient.invalidateQueries(
            trpcReact.mcpApps.hasUiForToolCall.pathFilter(),
          );
          void queryClient.invalidateQueries(
            trpcReact.mcpApps.getUiResourceForToolCall.pathFilter(),
          );
        },
      },
    ),
  );

  // Fallback for the race where this call completes before the subscription
  // above is established: once the call settles, re-check the per-call lookup.
  const status = toolCall.status;
  useEffect(() => {
    if (!enabled || !isExec) return;
    if (status !== "completed" && status !== "failed") return;
    void queryClient.invalidateQueries(
      trpcReact.mcpApps.hasUiForToolCall.pathFilter(),
    );
    void queryClient.invalidateQueries(
      trpcReact.mcpApps.getUiResourceForToolCall.pathFilter(),
    );
  }, [enabled, isExec, status, queryClient, trpcReact]);

  return (
    <>
      <McpToolView {...props} />
      {hasUi && !isDisabledForServer && (
        <McpAppHost {...props} serverName={serverName} toolName={toolName} />
      )}
    </>
  );
}
