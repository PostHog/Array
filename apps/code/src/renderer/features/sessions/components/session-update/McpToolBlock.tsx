import { McpAppHost } from "@features/mcp-apps/components/McpAppHost";
import { McpToolView } from "@features/mcp-apps/components/McpToolView";
import { parseMcpToolKey } from "@features/mcp-apps/utils/mcp-app-host-utils";
import { useSettingsStore } from "@features/settings/stores/settingsStore";
import { useTRPC } from "@renderer/trpc/client";
import {
  POSTHOG_EXEC_TOOL_KEY,
  resolveResultResourceUri,
} from "@shared/types/mcp-apps";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import type { ToolViewProps } from "./toolCallUtils";

interface McpToolBlockProps extends ToolViewProps {
  mcpToolName: string;
}

export function McpToolBlock(props: McpToolBlockProps) {
  const { mcpToolName, toolCall } = props;
  const { serverName, toolName } = parseMcpToolKey(mcpToolName);

  // PostHog's built-in `exec` tool surfaces UI apps through each call's response
  // `_meta` rather than registration-time tool metadata. The resolved `ui://`
  // URI lives on `toolCall.rawOutput`, which is persisted in the conversation —
  // so deriving it from the prop makes exec UI apps survive app restarts.
  const isExec = mcpToolName === POSTHOG_EXEC_TOOL_KEY;
  const execResourceUri = isExec
    ? resolveResultResourceUri(toolCall.rawOutput)
    : undefined;

  const mcpAppsDisabled = useSettingsStore((s) => s.mcpAppsDisabledServers);
  const isDisabledForServer = mcpAppsDisabled.includes(serverName);

  const trpcReact = useTRPC();
  const queryClient = useQueryClient();

  // Registration-discovered tools: a stable per-tool association rebuilt at boot.
  const { data: hasUiByTool } = useQuery(
    trpcReact.mcpApps.hasUiForTool.queryOptions(
      { toolKey: mcpToolName },
      { staleTime: Infinity, enabled: !isDisabledForServer && !isExec },
    ),
  );

  const hasUi = isExec ? !!execResourceUri : hasUiByTool;

  // Discovery completing signals that MCP server configs are now populated and
  // a connection can be opened. Two reasons to react:
  //  - registration path: a UI may have been newly discovered → refresh the gate.
  //  - exec path: when viewing a past conversation on app boot, the resource
  //    fetch can run before any session populates the server config and fail
  //    with "No server config". Re-fetch once discovery lands so it succeeds.
  useSubscription(
    trpcReact.mcpApps.onDiscoveryComplete.subscriptionOptions(undefined, {
      enabled: !isDisabledForServer,
      onData: (_event) => {
        if (isExec) {
          void queryClient.invalidateQueries(
            trpcReact.mcpApps.getUiResourceByUri.pathFilter(),
          );
          return;
        }
        void queryClient.invalidateQueries(
          trpcReact.mcpApps.hasUiForTool.pathFilter(),
        );
        void queryClient.invalidateQueries(
          trpcReact.mcpApps.getUiResource.pathFilter(),
        );
      },
    }),
  );

  return (
    <>
      <McpToolView {...props} />
      {hasUi && !isDisabledForServer && (
        <McpAppHost {...props} serverName={serverName} toolName={toolName} />
      )}
    </>
  );
}
