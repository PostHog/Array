import type {
  CloudMcpServerImport,
  LocalMcpServerDescriptor,
  LocalMcpServerScope,
} from "@posthog/shared";
import { inject, injectable } from "inversify";
import { LOCAL_MCP_WORKSPACE_CLIENT } from "./identifiers";

/** The slice of workspace-server this service needs, bound by the host. */
export interface LocalMcpWorkspaceClient {
  listLocalMcpServers(cwd?: string): Promise<LocalMcpServerDescriptor[]>;
}

export type LocalMcpCloudAvailability =
  /** url-based server on a publicly reachable host; can be forwarded to the sandbox. */
  | "importable"
  /** stdio server or private-network URL; only usable through a desktop relay. */
  | "requires_desktop"
  /** shape we can't run anywhere (unparseable URL, unrecognized transport). */
  | "unsupported";

export type LocalMcpCloudReason =
  | "public_url"
  | "private_url"
  | "stdio_transport"
  | "invalid_url"
  | "unsupported_transport";

export interface LocalMcpCloudClassification {
  name: string;
  scope: LocalMcpServerScope;
  transportType: "http" | "sse" | "stdio" | "unknown";
  availability: LocalMcpCloudAvailability;
  reason: LocalMcpCloudReason;
  /** Sandbox-shaped config; present only when availability is "importable". */
  remote?: CloudMcpServerImport;
}

function parseIpv4(host: string): [number, number, number, number] | null {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return null;
  return octets as [number, number, number, number];
}

function isPrivateIpv4([a, b]: [number, number, number, number]): boolean {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT, incl. Tailscale IPs
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;
  return a === 192 && b === 168;
}

const PRIVATE_HOST_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".lan",
  ".home",
  ".home.arpa",
  ".ts.net", // Tailscale MagicDNS
];

/**
 * Heuristic: is this hostname only reachable from the user's own machine or
 * network? Errs toward private — a public server misclassified as private
 * just stays desktop-only, while the reverse would ship an unreachable server
 * to the sandbox.
 */
export function isPrivateHostname(hostname: string): boolean {
  let host = hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host === "" || host === "localhost") return true;

  if (host.includes(":")) {
    // IPv6
    if (host === "::" || host === "::1") return true;
    const v4Mapped = host.match(/^::ffff:(.+)$/)?.[1];
    if (v4Mapped) {
      const octets = parseIpv4(v4Mapped);
      return octets ? isPrivateIpv4(octets) : false;
    }
    // fc00::/7 unique-local, fe80::/10 link-local
    return /^(f[cd]|fe[89ab])/.test(host);
  }

  const octets = parseIpv4(host);
  if (octets) return isPrivateIpv4(octets);

  // Bare intranet names ("nas", "router") only resolve on the local network.
  if (!host.includes(".")) return true;

  return PRIVATE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export function classifyLocalMcpServer(
  server: LocalMcpServerDescriptor,
): LocalMcpCloudClassification {
  const base = { name: server.name, scope: server.scope };
  const transport = server.transport;

  if (transport.type === "stdio") {
    return {
      ...base,
      transportType: "stdio",
      availability: "requires_desktop",
      reason: "stdio_transport",
    };
  }
  if (transport.type === "unknown") {
    return {
      ...base,
      transportType: "unknown",
      availability: "unsupported",
      reason: "unsupported_transport",
    };
  }

  let url: URL;
  try {
    url = new URL(transport.url);
  } catch {
    return {
      ...base,
      transportType: transport.type,
      availability: "unsupported",
      reason: "invalid_url",
    };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ...base,
      transportType: transport.type,
      availability: "unsupported",
      reason: "invalid_url",
    };
  }
  if (isPrivateHostname(url.hostname)) {
    return {
      ...base,
      transportType: transport.type,
      availability: "requires_desktop",
      reason: "private_url",
    };
  }
  return {
    ...base,
    transportType: transport.type,
    availability: "importable",
    reason: "public_url",
    remote: {
      type: transport.type,
      name: server.name,
      url: transport.url,
      headers: Object.entries(transport.headers ?? {}).map(([name, value]) => ({
        name,
        value,
      })),
    },
  };
}

@injectable()
export class LocalMcpImportService {
  constructor(
    @inject(LOCAL_MCP_WORKSPACE_CLIENT)
    private readonly workspace: LocalMcpWorkspaceClient,
  ) {}

  /**
   * Classifies the user's local MCP servers by whether they can be imported
   * into a cloud sandbox. `cwd` picks up ~/.claude.json project-scoped
   * servers for that checkout in addition to user-scoped ones.
   */
  async getCloudAvailability(
    cwd?: string,
  ): Promise<LocalMcpCloudClassification[]> {
    const servers = await this.workspace.listLocalMcpServers(cwd);
    return servers.map(classifyLocalMcpServer);
  }
}
