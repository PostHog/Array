import { describe, expect, it } from "vitest";
import {
  buildGatewayInstallRequest,
  canSubmitGatewayServer,
  effectiveCredentialMode,
  GATEWAY_ADD_SERVER_DEFAULTS,
  type GatewayAddServerValues,
} from "./gatewayAddServer";

function values(
  overrides: Partial<GatewayAddServerValues> = {},
): GatewayAddServerValues {
  return {
    ...GATEWAY_ADD_SERVER_DEFAULTS,
    name: "Internal Wiki",
    url: "https://mcp.example.com/sse",
    ...overrides,
  };
}

describe("canSubmitGatewayServer", () => {
  it.each([
    ["valid name and url", values(), true],
    ["missing name", values({ name: "  " }), false],
    ["invalid url", values({ url: "not-a-url" }), false],
  ])("%s", (_label, input, expected) => {
    expect(canSubmitGatewayServer(input)).toBe(expected);
  });
});

describe("effectiveCredentialMode", () => {
  it("forces shared for api-key servers", () => {
    expect(
      effectiveCredentialMode(
        values({ authType: "api_key", credentialMode: "individual" }),
      ),
    ).toBe("shared");
  });

  it("respects the chosen mode for oauth servers", () => {
    expect(
      effectiveCredentialMode(
        values({ authType: "oauth", credentialMode: "shared" }),
      ),
    ).toBe("shared");
    expect(effectiveCredentialMode(values({ authType: "oauth" }))).toBe(
      "individual",
    );
  });
});

describe("buildGatewayInstallRequest", () => {
  it("builds an individual oauth install with admin sharing options", () => {
    const request = buildGatewayInstallRequest(
      values({ description: "  Wiki tools  ", agentIds: ["svc-1"] }),
      { isAdmin: true, canManageAgentAccess: true },
    );
    expect(request).toEqual({
      name: "Internal Wiki",
      url: "https://mcp.example.com/sse",
      description: "Wiki tools",
      auth_type: "oauth",
      scope: "personal",
      team_enabled: true,
      agent_ids: ["svc-1"],
    });
  });

  it("marks shared-credential installs and carries allow_personal", () => {
    const request = buildGatewayInstallRequest(
      values({ credentialMode: "shared", allowPersonal: false }),
      { isAdmin: true, canManageAgentAccess: true },
    );
    expect(request.scope).toBe("shared");
    expect(request.allow_personal).toBe(false);
  });

  it("api-key installs share the key and include it", () => {
    const request = buildGatewayInstallRequest(
      values({ authType: "api_key", apiKey: "sk-123" }),
      { isAdmin: true, canManageAgentAccess: true },
    );
    expect(request.auth_type).toBe("api_key");
    expect(request.api_key).toBe("sk-123");
    expect(request.scope).toBe("shared");
  });

  it("includes oauth client credentials only when provided", () => {
    const bare = buildGatewayInstallRequest(values(), {
      isAdmin: true,
      canManageAgentAccess: true,
    });
    expect(bare.client_id).toBeUndefined();
    const withCreds = buildGatewayInstallRequest(
      values({ clientId: " id ", clientSecret: "secret" }),
      { isAdmin: true, canManageAgentAccess: true },
    );
    expect(withCreds.client_id).toBe("id");
    expect(withCreds.client_secret).toBe("secret");
  });

  it("lets permitted members share with agents without team-wide options", () => {
    const request = buildGatewayInstallRequest(
      values({ credentialMode: "shared", agentIds: ["svc-1"] }),
      { isAdmin: false, canManageAgentAccess: true },
    );
    expect(request.scope).toBeUndefined();
    expect(request.team_enabled).toBeUndefined();
    expect(request.allow_personal).toBeUndefined();
    expect(request.agent_ids).toEqual(["svc-1"]);
  });

  it("omits agent grants when team settings make them admin-only", () => {
    const request = buildGatewayInstallRequest(
      values({ agentIds: ["svc-1"] }),
      { isAdmin: false, canManageAgentAccess: false },
    );
    expect(request.agent_ids).toBeUndefined();
  });
});
