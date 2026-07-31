import type {
  McpGatewayServer,
  McpGatewayYourConnection,
  McpResolvedToolPolicy,
} from "@posthog/api-client/posthog-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  countGatewayServersByCategory,
  countPoliciesByState,
  defaultAgentGrantPolicy,
  filterGatewayServers,
  formatAgo,
  formatAuditTime,
  getGatewayConnectionStatus,
  getGatewayServerRemovalAction,
  isAgentPolicyState,
  isConnectedForYou,
  isPolicyStateAllowedByCeiling,
  partitionRailServers,
  resolvePolicyStateForScope,
} from "./gatewayServers";

describe("agent tool policies", () => {
  it.each([
    ["approved", true],
    ["needs_approval", false],
    ["do_not_use", true],
  ] as const)("allows %s for agents: %s", (state, expected) => {
    expect(isAgentPolicyState(state)).toBe(expected);
  });

  it("treats approval-gated tools as blocked for agents only", () => {
    expect(resolvePolicyStateForScope("needs_approval", "agent")).toBe(
      "do_not_use",
    );
    expect(resolvePolicyStateForScope("needs_approval", "member")).toBe(
      "needs_approval",
    );
    expect(resolvePolicyStateForScope("needs_approval", "team")).toBe(
      "needs_approval",
    );
  });
});

describe("isPolicyStateAllowedByCeiling", () => {
  it.each([
    ["approved", "needs_approval", false],
    ["needs_approval", "needs_approval", true],
    ["do_not_use", "needs_approval", true],
    ["approved", "do_not_use", false],
    ["needs_approval", "do_not_use", false],
    ["do_not_use", "do_not_use", true],
    ["approved", "approved", true],
    ["approved", null, true],
  ] as const)("%s under a %s ceiling is %s", (state, ceiling, expected) => {
    expect(isPolicyStateAllowedByCeiling(state, ceiling)).toBe(expected);
  });
});

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

  it("splits individual installations from shared servers", () => {
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
    [
      "connection needing reauth does not count",
      server({ your_connection: connection({ needs_reauth: true }) }),
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

describe("getGatewayConnectionStatus", () => {
  it.each([
    ["connected", connection(), "connected"],
    ["pending OAuth", connection({ pending_oauth: true }), "pending_oauth"],
    [
      "needs reauthorization",
      connection({ needs_reauth: true }),
      "needs_reauth",
    ],
    [
      "reauthorization takes precedence when both flags are set",
      connection({ pending_oauth: true, needs_reauth: true }),
      "needs_reauth",
    ],
  ] as const)("returns the status for %s", (_label, value, expected) => {
    expect(getGatewayConnectionStatus(value)).toBe(expected);
  });
});

describe("getGatewayServerRemovalAction", () => {
  const gatewayUser = (id: number) => ({
    id,
    uuid: `user-${id}`,
    email: `user-${id}@example.com`,
    hedgehog_config: null,
  });

  it.each([
    [
      "deletes a personally added custom server",
      server({
        created_by: gatewayUser(1),
        your_connection: connection(),
        connections: [
          {
            installation_id: "inst-1",
            user: gatewayUser(1),
            last_used_at: null,
            pending_oauth: false,
            needs_reauth: false,
          },
        ],
      }),
      false,
      "delete_for_you",
    ],
    [
      "disconnects from a custom server added by someone else",
      server({
        created_by: gatewayUser(2),
        your_connection: connection(),
        connections: [
          {
            installation_id: "inst-1",
            user: gatewayUser(1),
            last_used_at: null,
            pending_oauth: false,
            needs_reauth: false,
          },
        ],
      }),
      false,
      "disconnect",
    ],
    [
      "disconnects from a catalog server",
      server({
        template_id: "template-1",
        created_by: gatewayUser(1),
        your_connection: connection(),
        connections: [
          {
            installation_id: "inst-1",
            user: gatewayUser(1),
            last_used_at: null,
            pending_oauth: false,
            needs_reauth: false,
          },
        ],
      }),
      false,
      "disconnect",
    ],
    [
      "disconnects a personal override from a shared custom server",
      server({
        auth_mode: "shared",
        created_by: gatewayUser(1),
        your_connection: connection(),
        connections: [
          {
            installation_id: "inst-1",
            user: gatewayUser(1),
            last_used_at: null,
            pending_oauth: false,
            needs_reauth: false,
          },
        ],
      }),
      false,
      "disconnect",
    ],
    [
      "deletes a custom server for everyone when requested by an admin",
      server({}),
      true,
      "delete_for_everyone",
    ],
    [
      "does not delete a catalog server for an admin without a connection",
      server({ template_id: "template-1" }),
      true,
      null,
    ],
    [
      "returns no action without a personal connection",
      server({}),
      false,
      null,
    ],
  ] as const)("%s", (_label, srv, isAdmin, expected) => {
    expect(getGatewayServerRemovalAction(srv, isAdmin)).toBe(expected);
  });
});

describe("countPoliciesByState", () => {
  it("counts each state, defaulting to zero", () => {
    const policy = (state: McpResolvedToolPolicy["policy_state"]) =>
      ({
        tool_name: "t",
        description: "",
        input_schema: {},
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

  it("counts approval-gated agent tools as blocked", () => {
    expect(
      countPoliciesByState(
        [
          {
            tool_name: "send_message",
            description: "",
            input_schema: {},
            policy_state: "needs_approval",
            team_state: null,
            locked: false,
            decided_by: "scope",
            rule_name: "",
            rule_description: "",
          },
        ],
        "agent",
      ),
    ).toEqual({ approved: 0, needs_approval: 0, do_not_use: 1 });
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
