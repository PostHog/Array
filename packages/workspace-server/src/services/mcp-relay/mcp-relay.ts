import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import {
  type ClaudeJsonMcpServerEntry,
  loadUserClaudeJsonMcpServerEntries,
} from "@posthog/agent/adapters/claude/session/mcp-config";
import {
  ROOT_LOGGER,
  type RootLogger,
  type ScopedLogger,
} from "@posthog/di/logger";
import { inject, injectable, preDestroy } from "inversify";
import type { McpRelayExecution, McpRelayService } from "./identifiers";

const RESPONSE_TIMEOUT_MS = 55_000;
const MAX_RESPONSE_BYTES = 256_000;

interface PendingRequest {
  /** The sandbox-assigned JSON-RPC id, restored on the response. */
  originalId: unknown;
  resolve: (execution: McpRelayExecution) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface RelayConnection {
  transport: Transport;
  nextLocalId: number;
  pending: Map<number, PendingRequest>;
  closed: boolean;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sanitizeStringRecord(
  value: unknown,
): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * Desktop-side executor for the cloud MCP relay (docs/cloud-mcp-relay.md).
 *
 * Owns one real MCP connection per `(runId, server)`, created lazily on the
 * first relayed request and resolved by name from the user's local
 * ~/.claude.json config — configuration never crosses the wire. Connections
 * are per-run so each sandbox session's `initialize` handshake and JSON-RPC
 * id-space maps 1:1 onto its own real connection, keeping verbatim
 * passthrough correct.
 */
@injectable()
export class McpRelayServiceImpl implements McpRelayService {
  /** runId → server name → lazily opened connection. */
  private readonly connections = new Map<
    string,
    Map<string, Promise<RelayConnection>>
  >();

  protected responseTimeoutMs = RESPONSE_TIMEOUT_MS;

  private readonly log: ScopedLogger;

  constructor(@inject(ROOT_LOGGER) logger: RootLogger) {
    this.log = logger.scope("McpRelay");
  }

  async execute(
    runId: string,
    server: string,
    payload: Record<string, unknown>,
  ): Promise<McpRelayExecution> {
    let byServer = this.connections.get(runId);
    let connectionPromise = byServer?.get(server);

    if (!connectionPromise) {
      const entry = this.loadServerEntries().find((e) => e.name === server);
      if (!entry) {
        this.log.warn("Relay request for unknown local MCP server", {
          runId,
          server,
        });
        return {
          error: {
            code: -32601,
            message: `Unknown local MCP server: ${server}`,
          },
        };
      }
      connectionPromise = this.openConnection(runId, server, entry);
      if (!byServer) {
        byServer = new Map();
        this.connections.set(runId, byServer);
      }
      byServer.set(server, connectionPromise);
    }

    let connection: RelayConnection;
    try {
      connection = await connectionPromise;
    } catch (err) {
      // Evict the failed connection so the next execute lazily reconnects
      // (e.g. a stdio respawn after a crash-on-start).
      this.evict(runId, server, connectionPromise);
      this.log.warn("Failed to connect to local MCP server", {
        runId,
        server,
        error: errorMessage(err),
      });
      return { error: { code: -32000, message: errorMessage(err) } };
    }

    if (payload.id === undefined) {
      // JSON-RPC notification: fire-and-forget, no response correlation.
      try {
        await connection.transport.send(payload as JSONRPCMessage);
      } catch (err) {
        return { error: { code: -32000, message: errorMessage(err) } };
      }
      return {};
    }

    return this.sendRequest(connection, payload);
  }

  async closeRun(runId: string): Promise<void> {
    const byServer = this.connections.get(runId);
    if (!byServer) return;
    this.connections.delete(runId);
    for (const [server, connectionPromise] of byServer) {
      await this.closeConnection(runId, server, connectionPromise);
    }
  }

  @preDestroy()
  async dispose(): Promise<void> {
    for (const runId of [...this.connections.keys()]) {
      await this.closeRun(runId);
    }
  }

  /** Seam for tests: resolves the user's local MCP server entries by name. */
  protected loadServerEntries(): ClaudeJsonMcpServerEntry[] {
    return loadUserClaudeJsonMcpServerEntries();
  }

  /** Seam for tests: constructs the raw transport for a resolved entry. */
  protected createTransport(entry: ClaudeJsonMcpServerEntry): Transport {
    // ~/.claude.json is hand-editable, so treat the parsed config as untyped.
    const raw = entry.config as Record<string, unknown>;
    const type = typeof raw.type === "string" ? raw.type : undefined;
    const url = typeof raw.url === "string" ? raw.url : undefined;
    const command = typeof raw.command === "string" ? raw.command : undefined;
    const headers = sanitizeStringRecord(raw.headers);

    if ((type === undefined || type === "stdio") && command) {
      const args = Array.isArray(raw.args)
        ? raw.args.filter((arg): arg is string => typeof arg === "string")
        : undefined;
      return new StdioClientTransport({
        command,
        args,
        env: { ...getDefaultEnvironment(), ...sanitizeStringRecord(raw.env) },
      });
    }
    if (type === "sse" && url) {
      return new SSEClientTransport(new URL(url), {
        requestInit: headers ? { headers } : undefined,
      });
    }
    if ((type === "http" || type === undefined) && url) {
      return new StreamableHTTPClientTransport(new URL(url), {
        requestInit: headers ? { headers } : undefined,
      });
    }
    throw new Error(
      `Local MCP server "${entry.name}" has an unsupported configuration`,
    );
  }

  private async openConnection(
    runId: string,
    server: string,
    entry: ClaudeJsonMcpServerEntry,
  ): Promise<RelayConnection> {
    const transport = this.createTransport(entry);
    const connection: RelayConnection = {
      transport,
      nextLocalId: 1,
      pending: new Map(),
      closed: false,
    };

    transport.onmessage = (message) => {
      this.handleMessage(connection, message);
    };
    transport.onerror = (error) => {
      this.log.warn("Local MCP transport error", {
        runId,
        server,
        error: errorMessage(error),
      });
    };
    transport.onclose = () => {
      // A crashed stdio process (or dropped connection) fails fast instead of
      // stranding pending requests until the timeout; the eviction makes the
      // next execute lazily reconnect.
      this.teardown(connection, {
        code: -32000,
        message: `Connection to local MCP server "${server}" closed`,
      });
      this.evictSettled(runId, server, connection);
    };

    await transport.start();
    this.log.info("Connected to local MCP server", { runId, server });
    return connection;
  }

  private sendRequest(
    connection: RelayConnection,
    payload: Record<string, unknown>,
  ): Promise<McpRelayExecution> {
    // Remap the sandbox's JSON-RPC id onto a locally unique one so concurrent
    // relayed requests can never collide on the real connection; the original
    // id is restored on the response.
    const localId = connection.nextLocalId++;
    const execution = new Promise<McpRelayExecution>((resolve) => {
      const timer = setTimeout(() => {
        connection.pending.delete(localId);
        resolve({
          error: {
            code: -32001,
            message: "Local MCP server did not respond",
          },
        });
      }, this.responseTimeoutMs);
      timer.unref?.();
      connection.pending.set(localId, {
        originalId: payload.id,
        resolve,
        timer,
      });
    });

    return connection.transport
      .send({ ...payload, id: localId } as JSONRPCMessage)
      .then(
        () => execution,
        (err) => {
          const pending = connection.pending.get(localId);
          if (pending) {
            connection.pending.delete(localId);
            clearTimeout(pending.timer);
          }
          return { error: { code: -32000, message: errorMessage(err) } };
        },
      );
  }

  private handleMessage(
    connection: RelayConnection,
    message: JSONRPCMessage,
  ): void {
    const localId = (message as { id?: unknown }).id;
    if (typeof localId !== "number") {
      // Server-initiated requests/notifications have no relay counterpart.
      this.log.debug("Dropping non-response message from local MCP server");
      return;
    }
    const pending = connection.pending.get(localId);
    if (!pending) return;
    connection.pending.delete(localId);
    clearTimeout(pending.timer);

    const response: Record<string, unknown> = {
      ...(message as Record<string, unknown>),
      id: pending.originalId,
    };
    if (
      Buffer.byteLength(JSON.stringify(response), "utf8") > MAX_RESPONSE_BYTES
    ) {
      pending.resolve({
        error: {
          code: -32003,
          message: "Relayed MCP response exceeds 256 KB",
        },
      });
      return;
    }
    pending.resolve({ payload: response });
  }

  /** Settles every pending request with `error` and closes exactly once. */
  private teardown(
    connection: RelayConnection,
    error: { code: number; message: string },
  ): void {
    if (connection.closed) return;
    connection.closed = true;
    for (const pending of connection.pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve({ error });
    }
    connection.pending.clear();
  }

  private async closeConnection(
    runId: string,
    server: string,
    connectionPromise: Promise<RelayConnection>,
  ): Promise<void> {
    let connection: RelayConnection;
    try {
      connection = await connectionPromise;
    } catch {
      return;
    }
    this.teardown(connection, {
      code: -32000,
      message: `Connection to local MCP server "${server}" closed`,
    });
    try {
      await connection.transport.close();
    } catch (err) {
      this.log.warn("Failed to close local MCP transport", {
        runId,
        server,
        error: errorMessage(err),
      });
    }
  }

  /** Drops the cached connection if it is still the one that failed. */
  private evict(
    runId: string,
    server: string,
    connectionPromise: Promise<RelayConnection>,
  ): void {
    const byServer = this.connections.get(runId);
    if (byServer?.get(server) !== connectionPromise) return;
    byServer.delete(server);
    if (byServer.size === 0) this.connections.delete(runId);
  }

  /** Drops the cached connection if it resolved to `connection`. */
  private evictSettled(
    runId: string,
    server: string,
    connection: RelayConnection,
  ): void {
    const byServer = this.connections.get(runId);
    const cached = byServer?.get(server);
    if (!byServer || !cached) return;
    void cached.then(
      (resolved) => {
        if (resolved !== connection) return;
        if (byServer.get(server) !== cached) return;
        byServer.delete(server);
        if (byServer.size === 0) this.connections.delete(runId);
      },
      () => {},
    );
  }
}
