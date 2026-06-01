import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { IUrlLauncher } from "@posthog/platform/url-launcher";
import {
  BUILTIN_POSTHOG_SERVER_NAME,
  EXEC_TOOL_NAME,
  type McpAppsDiscoveryCompleteEvent,
  McpAppsServiceEvent,
  type McpAppsServiceEvents,
  type McpAppsToolCallUiDiscoveredEvent,
  type McpAppsToolCancelledEvent,
  type McpAppsToolInputEvent,
  type McpAppsToolResultEvent,
  type McpResourceUiMeta,
  type McpServerConnectionConfig,
  type McpToolUiAssociation,
  type McpToolUiMeta,
  type McpUiResource,
  POSTHOG_EXEC_TOOL_KEY,
  resolveResultResourceUri,
} from "@shared/types/mcp-apps";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";

const log = logger.scope("mcp-apps-service");

const UI_MIME_TYPE = "text/html;profile=mcp-app";
const MAX_HTML_SIZE = 5 * 1024 * 1024; // 5MB

interface ServerConnection {
  name: string;
  client: Client;
  transport: StreamableHTTPClientTransport;
}

@injectable()
export class McpAppsService extends TypedEventEmitter<McpAppsServiceEvents> {
  private connections = new Map<string, ServerConnection>();
  private resourceCache = new Map<string, McpUiResource>();
  private toolAssociations = new Map<string, McpToolUiAssociation>();
  /**
   * Per-tool-call UI associations for PostHog's built-in `exec` tool, keyed by
   * `toolCallId`. The `exec` tool can't be discovered via `listTools()` (its UI
   * `resourceUri` rides on each call's response `_meta`, not its registration),
   * so associations here are populated lazily in {@link notifyToolResult}.
   */
  private execToolCallAssociations = new Map<string, McpToolUiAssociation>();
  private toolDefinitions = new Map<string, Tool>();
  private serverConfigs = new Map<string, McpServerConnectionConfig>();
  private pendingConnections = new Map<string, Promise<ServerConnection>>();
  private pendingFetches = new Map<string, Promise<McpUiResource | null>>();
  private resourceMetaCache = new Map<string, McpResourceUiMeta>();

  constructor(
    @inject(MAIN_TOKENS.UrlLauncher)
    private readonly urlLauncher: IUrlLauncher,
  ) {
    super();
  }

  /**
   * Store server configs for lazy connections later.
   * No connections are created at this point.
   */
  setServerConfigs(configs: McpServerConnectionConfig[]): void {
    this.serverConfigs.clear();
    for (const config of configs) {
      this.serverConfigs.set(config.name, config);
    }
  }

  /**
   * Called when the agent confirms MCP servers are connected.
   * Connects to each server, calls listTools() to discover _meta.ui fields
   * (which the agent SDK strips), then populates tool associations and
   * emits DiscoveryComplete.
   */
  async handleDiscovery(serverNames: string[]): Promise<void> {
    await Promise.allSettled(
      serverNames
        .filter((name) => this.serverConfigs.has(name))
        .map((name) => this.discoverServerUiTools(name)),
    );

    const toolKeys = [...this.toolAssociations.keys()];
    log.info("Discovery complete", {
      serverNames,
      toolKeys,
      associationCount: this.toolAssociations.size,
    });

    this.emit(McpAppsServiceEvent.DiscoveryComplete, {
      toolKeys,
    } satisfies McpAppsDiscoveryCompleteEvent);
  }

  /**
   * Connect to a single server and call listTools() to discover which
   * tools have _meta.ui fields. The connection is kept for later reuse
   * (proxy calls, resource reads, lazy HTML fetches).
   */
  private async discoverServerUiTools(serverName: string): Promise<void> {
    try {
      const conn = await this.getOrCreateConnection(serverName);

      const [toolsList, resourcesList] = await Promise.all([
        conn.client.listTools(),
        conn.client.listResources().catch((err) => {
          log.warn("listResources failed during discovery", {
            serverName,
            error: err instanceof Error ? err.message : String(err),
          });
          return null;
        }),
      ]);

      for (const tool of toolsList.tools) {
        // The built-in PostHog `exec` tool carries no registration-time UI
        // resource (it resolves per call), but we still cache its definition so
        // the app bridge can surface it when a per-call UI is rendered.
        if (
          serverName === BUILTIN_POSTHOG_SERVER_NAME &&
          tool.name === EXEC_TOOL_NAME
        ) {
          this.toolDefinitions.set(POSTHOG_EXEC_TOOL_KEY, tool);
        }

        const uiMeta = (tool as McpToolUiMeta)._meta?.ui;
        if (!uiMeta?.resourceUri) continue;

        const toolKey = `mcp__${serverName}__${tool.name}`;
        this.toolAssociations.set(toolKey, {
          toolKey,
          serverName,
          toolName: tool.name,
          resourceUri: uiMeta.resourceUri,
          visibility: uiMeta.visibility,
        });
        this.toolDefinitions.set(toolKey, tool);
      }

      // Cache resource metadata (CSP, permissions) for use in fetchUiResource
      if (resourcesList) {
        for (const resource of resourcesList.resources) {
          const meta = resource as McpResourceUiMeta;
          if (meta._meta?.ui) {
            this.resourceMetaCache.set(resource.uri, meta);
          }
        }
      }
    } catch (err) {
      log.warn("Failed to discover UI tools for server", {
        serverName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Get or create a lazy MCP connection for a server.
   * Deduplicates concurrent connection attempts for the same server.
   */
  private async getOrCreateConnection(
    serverName: string,
  ): Promise<ServerConnection> {
    const existing = this.connections.get(serverName);
    if (existing) {
      log.debug("Reusing existing MCP connection", { serverName });
      return existing;
    }

    // Deduplicate concurrent connection attempts
    const pending = this.pendingConnections.get(serverName);
    if (pending) {
      log.info("Joining pending MCP connection attempt", { serverName });
      return pending;
    }

    const config = this.serverConfigs.get(serverName);
    if (!config) {
      throw new Error(`No server config for: ${serverName}`);
    }

    const connectionPromise = this.createConnection(config);
    this.pendingConnections.set(serverName, connectionPromise);

    try {
      const conn = await connectionPromise;
      this.connections.set(serverName, conn);
      return conn;
    } finally {
      this.pendingConnections.delete(serverName);
    }
  }

  private async createConnection(
    config: McpServerConnectionConfig,
  ): Promise<ServerConnection> {
    const transport = new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: {
        headers: config.headers,
      },
    });

    const client = new Client(
      { name: "Twig", version: "1.0.0" },
      {
        capabilities: {
          extensions: {
            "io.modelcontextprotocol/ui": {
              mimeTypes: [UI_MIME_TYPE],
            },
          },
        } as Record<string, unknown>,
      },
    );

    await client.connect(transport);

    log.info("Lazy MCP connection established", {
      serverName: config.name,
      serverVersion: client.getServerVersion(),
    });

    return { name: config.name, client, transport };
  }

  /**
   * Get the UI resource for a tool. Fetches lazily on first access:
   * creates an MCP connection if needed, then reads the resource HTML.
   * Deduplicates concurrent fetches for the same resource URI.
   */
  async getUiResourceForTool(toolKey: string): Promise<McpUiResource | null> {
    const association = this.toolAssociations.get(toolKey);
    if (!association) {
      log.debug("getUiResourceForTool: no association found", { toolKey });
      return null;
    }

    // Return cached resource immediately
    const cached = this.resourceCache.get(association.resourceUri);
    if (cached) {
      log.debug("getUiResourceForTool: cache hit", { toolKey });
      return cached;
    }

    // Deduplicate concurrent fetches for the same resource URI
    const pendingFetch = this.pendingFetches.get(association.resourceUri);
    if (pendingFetch) {
      log.debug("getUiResourceForTool: joining pending fetch", {
        toolKey,
        uri: association.resourceUri,
      });
      return pendingFetch;
    }

    // Start the fetch for this resource URI
    log.debug("getUiResourceForTool: starting lazy fetch", {
      toolKey,
      serverName: association.serverName,
      uri: association.resourceUri,
    });
    const fetchPromise = this.fetchUiResource(association);
    this.pendingFetches.set(association.resourceUri, fetchPromise);

    try {
      return await fetchPromise;
    } finally {
      this.pendingFetches.delete(association.resourceUri);
    }
  }

  private async fetchUiResource(
    association: McpToolUiAssociation,
  ): Promise<McpUiResource | null> {
    try {
      const conn = await this.getOrCreateConnection(association.serverName);
      const resourceResult = await conn.client.readResource({
        uri: association.resourceUri,
      });

      const textContent = resourceResult.contents.find(
        (c) => "text" in c && c.mimeType === UI_MIME_TYPE,
      );
      if (!textContent || !("text" in textContent)) {
        log.warn("UI resource had no matching text content", {
          serverName: association.serverName,
          uri: association.resourceUri,
          contentsCount: resourceResult.contents.length,
        });
        return null;
      }

      if (textContent.text.length > MAX_HTML_SIZE) {
        log.warn("UI resource HTML exceeds size limit", {
          uri: association.resourceUri,
          size: textContent.text.length,
          limit: MAX_HTML_SIZE,
        });
        return null;
      }

      // Use metadata cached during discovery
      const resourceMeta = this.resourceMetaCache.get(association.resourceUri);

      const resource: McpUiResource = {
        uri: association.resourceUri,
        name: resourceMeta?.name,
        mimeType: UI_MIME_TYPE,
        csp: resourceMeta?._meta?.ui?.csp,
        permissions: resourceMeta?._meta?.ui?.permissions,
        html: textContent.text,
        serverName: association.serverName,
      };

      this.resourceCache.set(association.resourceUri, resource);
      log.info("Lazily fetched and cached UI resource", {
        serverName: association.serverName,
        uri: association.resourceUri,
        htmlLength: textContent.text.length,
        hasCsp: !!resource.csp,
      });

      return resource;
    } catch (err) {
      log.warn("Failed to lazily fetch UI resource", {
        serverName: association.serverName,
        uri: association.resourceUri,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  hasUiForTool(toolKey: string): boolean {
    const has = this.toolAssociations.has(toolKey);
    log.debug("hasUiForTool", { toolKey, result: has });
    return has;
  }

  /**
   * Whether a UI app was resolved for a specific tool call. Only the built-in
   * PostHog `exec` tool populates this (via {@link notifyToolResult}); for
   * registration-discovered tools use {@link hasUiForTool}.
   */
  hasUiForToolCall(toolCallId: string): boolean {
    const has = this.execToolCallAssociations.has(toolCallId);
    log.debug("hasUiForToolCall", { toolCallId, result: has });
    return has;
  }

  /**
   * Fetch the UI resource resolved for a specific `exec` tool call. Reuses the
   * same lazy-fetch + cache path as registration-discovered tools.
   */
  async getUiResourceForToolCall(
    toolCallId: string,
  ): Promise<McpUiResource | null> {
    const association = this.execToolCallAssociations.get(toolCallId);
    if (!association) {
      log.debug("getUiResourceForToolCall: no association found", {
        toolCallId,
      });
      return null;
    }

    const cached = this.resourceCache.get(association.resourceUri);
    if (cached) return cached;

    const pendingFetch = this.pendingFetches.get(association.resourceUri);
    if (pendingFetch) return pendingFetch;

    const fetchPromise = this.fetchUiResource(association);
    this.pendingFetches.set(association.resourceUri, fetchPromise);
    try {
      return await fetchPromise;
    } finally {
      this.pendingFetches.delete(association.resourceUri);
    }
  }

  getToolDefinition(toolKey: string): Tool | null {
    return this.toolDefinitions.get(toolKey) ?? null;
  }

  async proxyToolCall(
    serverName: string,
    toolName: string,
    args?: Record<string, unknown>,
  ): Promise<unknown> {
    // Validate visibility: reject if tool is model-only
    const toolKey = `mcp__${serverName}__${toolName}`;
    const association = this.toolAssociations.get(toolKey);
    if (association?.visibility && !association.visibility.includes("app")) {
      throw new Error(
        `Tool "${toolName}" is not accessible to apps (visibility: ${association.visibility.join(", ")})`,
      );
    }

    const conn = await this.getOrCreateConnection(serverName);
    const result = await conn.client.callTool({
      name: toolName,
      arguments: args,
    });

    return result;
  }

  async proxyResourceRead(serverName: string, uri: string): Promise<unknown> {
    // Only allow ui:// scheme reads
    if (!uri.startsWith("ui://")) {
      throw new Error(`Only ui:// URIs are allowed, got: ${uri}`);
    }

    const conn = await this.getOrCreateConnection(serverName);
    const result = await conn.client.readResource({ uri });
    return result;
  }

  async openLink(url: string): Promise<void> {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(
        `Only http/https URLs are allowed, got: ${parsed.protocol}`,
      );
    }
    await this.urlLauncher.launch(url);
  }

  notifyToolInput(toolKey: string, toolCallId: string, args: unknown): void {
    log.info("notifyToolInput", { toolKey, toolCallId });
    this.emit(McpAppsServiceEvent.ToolInput, {
      toolKey,
      toolCallId,
      args,
    } satisfies McpAppsToolInputEvent);
  }

  notifyToolResult(
    toolKey: string,
    toolCallId: string,
    result: unknown,
    isError?: boolean,
  ): void {
    log.info("notifyToolResult", { toolKey, toolCallId, isError });

    // PostHog's built-in `exec` tool surfaces UI apps through the per-call
    // response `_meta` rather than registration-time tool metadata, so resolve
    // and register the association here before the result is forwarded.
    if (toolKey === POSTHOG_EXEC_TOOL_KEY && !isError) {
      this.registerExecToolCallUi(toolCallId, result);
    }

    this.emit(McpAppsServiceEvent.ToolResult, {
      toolKey,
      toolCallId,
      result,
      isError,
    } satisfies McpAppsToolResultEvent);
  }

  /**
   * Parse a `resourceUri` out of an `exec` call's response `_meta` and, when
   * present, record a per-call association and announce it so the renderer can
   * mount the UI app for this specific call.
   */
  private registerExecToolCallUi(toolCallId: string, result: unknown): void {
    if (this.execToolCallAssociations.has(toolCallId)) return;

    const resourceUri = resolveResultResourceUri(result);
    if (!resourceUri) {
      log.debug("registerExecToolCallUi: no UI resourceUri on result", {
        toolCallId,
      });
      return;
    }

    this.execToolCallAssociations.set(toolCallId, {
      toolKey: POSTHOG_EXEC_TOOL_KEY,
      serverName: BUILTIN_POSTHOG_SERVER_NAME,
      toolName: EXEC_TOOL_NAME,
      resourceUri,
    });
    log.info("registerExecToolCallUi: resolved per-call UI", {
      toolCallId,
      resourceUri,
    });

    this.emit(McpAppsServiceEvent.ToolCallUiDiscovered, {
      toolCallId,
      toolKey: POSTHOG_EXEC_TOOL_KEY,
      resourceUri,
    } satisfies McpAppsToolCallUiDiscoveredEvent);
  }

  notifyToolCancelled(toolKey: string, toolCallId: string): void {
    log.info("notifyToolCancelled", { toolKey, toolCallId });
    this.execToolCallAssociations.delete(toolCallId);
    this.emit(McpAppsServiceEvent.ToolCancelled, {
      toolKey,
      toolCallId,
    } satisfies McpAppsToolCancelledEvent);
  }

  /**
   * Clear all cached resources and connections, re-run discovery, and
   * emit DiscoveryComplete so the renderer refetches everything.
   * Intended for developer debugging via the File > Developer menu.
   */
  async refreshDiscovery(): Promise<void> {
    log.info("refreshDiscovery: clearing caches and re-running discovery");

    // Close existing connections
    for (const [, conn] of this.connections) {
      await conn.client.close().catch(() => {});
    }
    this.connections.clear();
    this.resourceCache.clear();
    this.resourceMetaCache.clear();
    this.toolAssociations.clear();
    this.execToolCallAssociations.clear();
    this.toolDefinitions.clear();
    this.pendingConnections.clear();
    this.pendingFetches.clear();

    // Re-discover using stored server configs
    const serverNames = [...this.serverConfigs.keys()];
    if (serverNames.length > 0) {
      await this.handleDiscovery(serverNames);
    } else {
      log.warn(
        "refreshDiscovery: no server configs stored, nothing to discover",
      );
    }
  }

  async disconnectServer(serverName: string): Promise<void> {
    const conn = this.connections.get(serverName);
    if (!conn) return;

    try {
      await conn.client.close();
    } catch (err) {
      log.warn("Error closing MCP connection", {
        serverName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    this.connections.delete(serverName);

    // Clean up associations and cached resources for this server
    const urisToEvict = new Set<string>();
    for (const [key, assoc] of this.toolAssociations) {
      if (assoc.serverName === serverName) {
        urisToEvict.add(assoc.resourceUri);
        this.toolAssociations.delete(key);
      }
    }
    for (const [callId, assoc] of this.execToolCallAssociations) {
      if (assoc.serverName === serverName) {
        urisToEvict.add(assoc.resourceUri);
        this.execToolCallAssociations.delete(callId);
      }
    }

    // Only evict cached resources not referenced by remaining associations
    const stillReferenced = new Set(
      [
        ...this.toolAssociations.values(),
        ...this.execToolCallAssociations.values(),
      ].map((a) => a.resourceUri),
    );
    for (const uri of urisToEvict) {
      if (!stillReferenced.has(uri)) {
        this.resourceCache.delete(uri);
      }
    }
  }

  async cleanup(): Promise<void> {
    const serverNames = [...this.connections.keys()];
    for (const name of serverNames) {
      await this.disconnectServer(name);
    }
    this.resourceCache.clear();
    this.resourceMetaCache.clear();
    this.toolAssociations.clear();
    this.execToolCallAssociations.clear();
    this.toolDefinitions.clear();
    this.serverConfigs.clear();
    this.pendingConnections.clear();
    this.pendingFetches.clear();
  }
}
