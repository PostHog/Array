import type {
  McpGatewayServer,
  McpGatewayYourConnection,
  McpResolvedToolPolicy,
} from "@posthog/api-client/posthog-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentHandlePreview,
  countGatewayServersByCategory,
  countPoliciesByState,
  defaultAgentGrantPolicy,
  filterGatewayServers,
  formatAgo,
  formatAuditTime,
  isConnectedForYou,
  partitionRailServers,
} from "./gatewayServers";

function connection(
  overrides: Partial<McpGatewayYourConnection> = {},
): McpGatewayYourConnection {
  return {
    installation_id: "inst-1",
    scope: "personal",
    is_enabled: true,
    pending_oauth: false,
    needs_reauth: false,
    last_used_at: null,
    ...overrides,
  };
}

function server(overrides: Partial<McpGatewayServer>): McpGatewayServer {
  return {
    id: "srv-1",
    name: "Test",
    url: "https://mcp.example.com",
    description: "",
    category: "dev",
    auth_mode: "individual",
    is_team_enabled: true,
    allow_personal_connections: true,
    icon_key: "",
    docs_url: "",
    template_id: null,
    tool_count: 0,
    connections: [],
    your_connection: null,
    shared_credential: null,
    agents: [],
    revoked_user_ids: [],
    is_revoked_for_you: false,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("partitionRailServers", () => {
  const servers = [
    server({ id: "a", name: "Alpha", your_connection: connection() }),
    server({ id: "b", name: "Beta" }),
    server({ id: "c", name: "Gamma", auth_mode: "shared" }),
    server({
      id: "d",
      name: "Delta",
      auth_mode: "shared",
      your_connection: connection(),
    }),
  ];

  it("splits connected individual servers from shared ones", () => {
    const { yourConnections, sharedWithYou } = partitionRailServers(
      servers,
      "",
    );
    expect(yourConnections.map((s) => s.id)).toEqual(["a"]);
    expect(sharedWithYou.map((s) => s.id)).toEqual(["c", "d"]);
  });

  it("filters both sections by name", () => {
    const { yourConnections, sharedWithYou } = partitionRailServers(
      servers,
      "gam",
    );
    expect(yourConnections).toEqual([]);
    expect(sharedWithYou.map((s) => s.id)).toEqual(["c"]);
  });
});

describe("filterGatewayServers", () => {
  const servers = [
    server({ id: "a", name: "Linear", description: "Ticket tracker" }),
    server({
      id: "b",
      name: "GitHub",
      description: "Code hosting",
      category: "data",
    }),
    server({ id: "c", name: "Notion", url: "https://mcp.notion.so" }),
  ];

  it("matches name, description and url case-insensitively", () => {
    expect(filterGatewayServers(servers, "TICKET", null)[0]?.id).toBe("a");
    expect(filterGatewayServers(servers, "notion.so", null)[0]?.id).toBe("c");
  });

  it("applies the category chip", () => {
    expect(filterGatewayServers(servers, "", "data").map((s) => s.id)).toEqual([
      "b",
    ]);
  });

  it("combines search and category", () => {
    expect(filterGatewayServers(servers, "linear", "data")).toEqual([]);
  });
});

describe("countGatewayServersByCategory", () => {
  it("tallies per category", () => {
    const counts = countGatewayServersByCategory([
      server({ id: "a", category: "dev" }),
      server({ id: "b", category: "dev" }),
      server({ id: "c", category: "data" }),
    ]);
    expect(counts).toEqual({ dev: 2, data: 1 });
  });
});

describe("isConnectedForYou", () => {
  it.each([
    [
      "personal connection",
      server({ your_connection: connection() }),
      false,
      true,
    ],
    [
      "pending oauth does not count",
      server({ your_connection: connection({ pending_oauth: true }) }),
      false,
      false,
    ],
    ["member on shared server", server({ auth_mode: "shared" }), false, true],
    [
      "admin on shared server without own connection",
      server({ auth_mode: "shared" }),
      true,
      false,
    ],
    ["not connected", server({}), false, false],
  ] as const)("%s", (_label, srv, isAdmin, expected) => {
    expect(isConnectedForYou(srv, isAdmin)).toBe(expected);
  });
});

describe("countPoliciesByState", () => {
  it("counts each state, defaulting to zero", () => {
    const policy = (state: McpResolvedToolPolicy["policy_state"]) =>
      ({
        tool_name: "t",
        description: "",
        policy_state: state,
        team_state: null,
        locked: false,
        decided_by: "default",
        rule_name: "",
        rule_description: "",
      }) satisfies McpResolvedToolPolicy;
    expect(
      countPoliciesByState([
        policy("approved"),
        policy("approved"),
        policy("do_not_use"),
      ]),
    ).toEqual({ approved: 2, needs_approval: 0, do_not_use: 1 });
  });
});

describe("time formatting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T12:00:00"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formatAgo renders short relative times", () => {
    expect(formatAgo("2026-07-21T10:00:00")).toBe("2h ago");
    expect(formatAgo("2026-07-21T11:59:50")).toBe("just now");
    expect(formatAgo(null)).toBeNull();
  });

  it("formatAuditTime buckets by local day", () => {
    expect(formatAuditTime("2026-07-21T09:58:00")).toBe("Today 09:58");
    expect(formatAuditTime("2026-07-20T17:22:00")).toBe("Yesterday 17:22");
    expect(formatAuditTime("2026-07-15T09:12:00")).toMatch(/^Jul 15 09:12$/);
  });
});

describe("defaultAgentGrantPolicy", () => {
  it.each([
    ["delete-row", "do_not_use"],
    ["run-migration", "do_not_use"],
    ["send", "do_not_use"],
    ["list-tables", "approved"],
    ["search", "approved"],
  ] as const)("%s → %s", (tool, expected) => {
    expect(defaultAgentGrantPolicy(tool)).toBe(expected);
  });
});

describe("agentHandlePreview", () => {
  it.each([
    ["Docs Agent", "svc-docs-agent"],
    ["  Support!! Bot  ", "svc-support-bot"],
    ["---", null],
    ["", null],
  ])("%s → %s", (name, expected) => {
    expect(agentHandlePreview(name)).toBe(expected);
  });
});
