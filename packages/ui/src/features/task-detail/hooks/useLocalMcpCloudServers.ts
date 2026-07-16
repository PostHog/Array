import { LOCAL_MCP_IMPORT_SERVICE } from "@posthog/core/local-mcp/identifiers";
import type {
  LocalMcpCloudClassification,
  LocalMcpImportService,
} from "@posthog/core/local-mcp/localMcpImport";
import { useServiceOptional } from "@posthog/di/react";
import { LOCAL_MCP_IMPORT_FLAG } from "@posthog/shared";
import { useQuery } from "@tanstack/react-query";
import { useFeatureFlag } from "../../feature-flags/useFeatureFlag";

/**
 * The user's local (~/.claude.json) MCP servers classified by cloud
 * availability. Empty on hosts without a local workspace (web/mobile — the
 * service is only bound on desktop) and while the feature flag is off.
 */
export function useLocalMcpCloudServers(
  enabled: boolean,
): LocalMcpCloudClassification[] {
  const service = useServiceOptional<LocalMcpImportService>(
    LOCAL_MCP_IMPORT_SERVICE,
  );
  const flagEnabled = useFeatureFlag(LOCAL_MCP_IMPORT_FLAG);

  const query = useQuery({
    queryKey: ["local-mcp-cloud-availability"],
    queryFn: () => {
      if (!service) return [];
      return service.getCloudAvailability();
    },
    enabled: enabled && flagEnabled && !!service,
    staleTime: 30_000,
  });

  return query.data ?? [];
}
