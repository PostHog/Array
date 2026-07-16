import { LOCAL_MCP_IMPORT_SERVICE } from "@posthog/core/local-mcp/identifiers";
import type {
  LocalMcpCloudClassification,
  LocalMcpImportService,
} from "@posthog/core/local-mcp/localMcpImport";
import { useServiceOptional } from "@posthog/di/react";
import { useQuery } from "@tanstack/react-query";

// Stable identity so consumers' memo deps don't churn while data is absent.
const NO_SERVERS: LocalMcpCloudClassification[] = [];

export interface LocalMcpCloudServersResult {
  servers: LocalMcpCloudClassification[];
  /** True only during the initial fetch while enabled — false once resolved,
   *  and false while disabled, so a disabled query never blocks a caller. */
  isLoading: boolean;
}

/**
 * The user's local (~/.claude.json) MCP servers classified by cloud
 * availability. Empty on hosts without a local workspace (web/mobile — the
 * service is only bound on desktop).
 */
export function useLocalMcpCloudServers(
  enabled: boolean,
): LocalMcpCloudServersResult {
  const service = useServiceOptional<LocalMcpImportService>(
    LOCAL_MCP_IMPORT_SERVICE,
  );

  const query = useQuery({
    queryKey: ["local-mcp-cloud-availability"],
    queryFn: () => (service ? service.getCloudAvailability() : NO_SERVERS),
    enabled: enabled && !!service,
    staleTime: 30_000,
  });

  return { servers: query.data ?? NO_SERVERS, isLoading: query.isLoading };
}
