import type { LocalMcpServerDescriptor } from "@posthog/shared";

export const LOCAL_MCP_SERVICE = Symbol.for("posthog.workspace.localMcp");

export interface LocalMcpService {
  /**
   * Lists the user's locally configured MCP servers
   * (~/.posthog-code/mcp.json).
   */
  listServers(cwd?: string): Promise<LocalMcpServerDescriptor[]>;
  getConfigFile(): Promise<{ path: string; content: string | null }>;
  updateConfigFile(content: string): Promise<{ path: string; content: string }>;
}
