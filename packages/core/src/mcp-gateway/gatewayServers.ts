import type {
  McpApprovalState,
  McpAuditDecision,
  McpGatewayServer,
  McpResolvedToolPolicy,
} from "@posthog/api-client/posthog-client";
import { formatRelativeTimeShort, getLocalDayDiff } from "@posthog/shared";

export interface GatewayRailPartition {
  /** Individual-auth servers the current user has connected. */
  yourConnections: McpGatewayServer[];
  /** Shared-credential servers — pre-authorized for the whole team. */
  sharedWithYou: McpGatewayServer[];
}

/** Split servers into the two rail sections, filtered by the rail search. */
export function partitionRailServers(
  servers: McpGatewayServer[],
  search: string,
): GatewayRailPartition {
  const query = search.trim().toLowerCase();
  const matches = (server: McpGatewayServer) =>
    !query || server.name.toLowerCase().includes(query);
  return {
    yourConnections: servers.filter(
      (server) =>
        server.auth_mode === "individual" &&
        server.your_connection !== null &&
        matches(server),
    ),
    sharedWithYou: servers.filter(
      (server) => server.auth_mode === "shared" && matches(server),
    ),
  };
}

/** Home-screen filter: search over name/description/url plus category chip. */
export function filterGatewayServers(
  servers: McpGatewayServer[],
  search: string,
  category: string | null,
): McpGatewayServer[] {
  const query = search.trim().toLowerCase();
  return servers.filter((server) => {
    if (category && server.category !== category) return false;
    if (!query) return true;
    return (
      server.name.toLowerCase().includes(query) ||
      server.description.toLowerCase().includes(query) ||
      server.url.toLowerCase().includes(query)
    );
  });
}

export function countGatewayServersByCategory(
  servers: McpGatewayServer[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const server of servers) {
    counts[server.category] = (counts[server.category] ?? 0) + 1;
  }
  return counts;
}

/**
 * Whether the current user can call this server without connecting first:
 * they hold a working personal connection, or (for non-admin members) the
 * shared credential pre-authorizes them.
 */
export function isConnectedForYou(
  server: McpGatewayServer,
  isAdmin: boolean,
): boolean {
  if (server.your_connection && !server.your_connection.pending_oauth) {
    return true;
  }
  return server.auth_mode === "shared" && !isAdmin;
}

export type GatewayPolicyCounts = Record<McpApprovalState, number>;

export function countPoliciesByState(
  policies: McpResolvedToolPolicy[],
): GatewayPolicyCounts {
  const counts: GatewayPolicyCounts = {
    approved: 0,
    needs_approval: 0,
    do_not_use: 0,
  };
  for (const policy of policies) {
    counts[policy.policy_state] += 1;
  }
  return counts;
}

/** "2h ago" / "just now" for last-used and last-active timestamps. */
export function formatAgo(timestamp: string | null): string | null {
  if (!timestamp) return null;
  const short = formatRelativeTimeShort(timestamp);
  return short === "now" ? "just now" : `${short} ago`;
}

/** Audit-table timestamp: "Today 09:58", "Yesterday 17:22", "Jul 15 09:12". */
export function formatAuditTime(timestamp: string, now?: Date): string {
  const date = new Date(timestamp);
  const dayDiff = getLocalDayDiff(date, now);
  const time = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (dayDiff <= 0) return `Today ${time}`;
  if (dayDiff === 1) return `Yesterday ${time}`;
  const day = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${day} ${time}`;
}

export const AUDIT_DECISION_LABELS: Record<McpAuditDecision, string> = {
  auto: "Auto-approved",
  approved: "Approved",
  pending: "Awaiting approval",
  blocked: "Blocked",
};

// Mirrors the backend's destructive-tool heuristic; only used to seed the
// per-tool defaults when sharing a server with an agent.
const DESTRUCTIVE_TOOL_RE =
  /delete|update|post|write|create|run-migration|close|drop|send/;

/** Default policy offered when granting an agent access to a tool. */
export function defaultAgentGrantPolicy(toolName: string): McpApprovalState {
  return DESTRUCTIVE_TOOL_RE.test(toolName) ? "do_not_use" : "approved";
}

/** Identity handle a new agent will authenticate as, e.g. "svc-docs-agent". */
export function agentHandlePreview(name: string): string | null {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug ? `svc-${slug}` : null;
}
