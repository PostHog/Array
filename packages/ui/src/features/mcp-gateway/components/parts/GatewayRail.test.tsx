import type { McpGatewayServer } from "@posthog/api-client/posthog-client";
import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GatewayRail } from "./GatewayRail";

vi.mock("@posthog/ui/features/mcp-servers/components/parts/icons", () => ({
  ServerIcon: () => <div aria-hidden="true" />,
}));

function sharedServer(): McpGatewayServer {
  return {
    id: "shared-server",
    name: "Shared server",
    url: "https://mcp.example.com",
    description: "",
    category: "dev",
    auth_mode: "shared",
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
  };
}

function renderRail(servers: McpGatewayServer[]) {
  return render(
    <Theme>
      <GatewayRail
        servers={servers}
        templatesById={new Map()}
        isAdmin={false}
        canAddServers={false}
        route={{ view: "servers" }}
        onNavigate={vi.fn()}
      />
    </Theme>,
  );
}

describe("GatewayRail", () => {
  it("hides the shared section when no servers are shared with you", () => {
    renderRail([]);

    expect(screen.queryByText("Shared with you")).not.toBeInTheDocument();
  });

  it("shows the shared section when a server is shared with you", () => {
    renderRail([sharedServer()]);

    expect(screen.getByText("Shared with you")).toBeInTheDocument();
    expect(screen.getByText("Shared server")).toBeInTheDocument();
  });
});
