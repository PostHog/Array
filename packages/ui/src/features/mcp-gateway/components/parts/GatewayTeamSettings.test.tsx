import type { McpGatewayServer } from "@posthog/api-client/posthog-client";
import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  servers: [] as McpGatewayServer[],
  updateServer: vi.fn(),
  setAllEnabled: vi.fn(),
}));

vi.mock("@posthog/ui/features/mcp-gateway/hooks/useGatewayConfig", () => ({
  useGatewayConfig: () => ({
    allowCustomServers: true,
    allowMemberAgentAccess: true,
    updateSettings: vi.fn(),
  }),
}));

vi.mock("@posthog/ui/features/mcp-gateway/hooks/useGatewayServers", () => ({
  useGatewayServers: () => ({
    servers: mocks.servers,
    updateServer: mocks.updateServer,
    setAllEnabled: mocks.setAllEnabled,
  }),
}));

vi.mock("@posthog/ui/features/mcp-servers/components/parts/icons", () => ({
  ServerIcon: () => <div aria-hidden="true" />,
}));

import { GatewayTeamSettings } from "./GatewayTeamSettings";

const server = {
  id: "server-1",
  name: "Linear",
  url: "https://mcp.linear.app",
  description: "",
  category: "productivity",
  is_team_enabled: true,
  icon_key: "",
  docs_url: "",
  template_id: null,
  tool_count: 0,
  connections: [],
  your_connection: null,
  agents: [],
  revoked_user_ids: [],
  is_revoked_for_you: false,
  created_by: null,
  created_at: "2026-07-23T12:00:00Z",
  updated_at: "2026-07-23T12:00:00Z",
} as McpGatewayServer;

describe("GatewayTeamSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.servers = [server];
  });

  it("opens a server detail page from the server access list", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(
      <Theme>
        <GatewayTeamSettings onNavigate={onNavigate} />
      </Theme>,
    );

    await user.click(screen.getByRole("button", { name: /Linear/ }));

    expect(onNavigate).toHaveBeenCalledWith({
      view: "server",
      serverId: server.id,
    });
  });
});
