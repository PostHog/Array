import type { McpResolvedToolPolicy } from "@posthog/api-client/posthog-client";
import {
  gatewayKeys,
  TEAM_SCOPE,
  YOU_SCOPE,
} from "@posthog/ui/features/mcp-gateway/hooks/gatewayKeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPolicies: vi.fn(),
  upsertPolicies: vi.fn(),
  refreshTools: vi.fn(),
}));

vi.mock("@posthog/ui/features/auth/authClient", () => ({
  useOptionalAuthenticatedClient: () => ({
    getMcpGatewayToolPolicies: mocks.getPolicies,
    upsertMcpGatewayToolPolicies: mocks.upsertPolicies,
    refreshMcpInstallationTools: mocks.refreshTools,
  }),
}));

vi.mock("@posthog/ui/primitives/toast", () => ({
  toast: { error: vi.fn() },
}));

import { useGatewayToolPolicies } from "./useGatewayToolPolicies";

const serverId = "server-1";

function policy(policyState: "needs_approval" | "approved") {
  return {
    tool_name: "search",
    description: "Search for things",
    input_schema: {},
    policy_state: policyState,
    team_state: policyState,
    locked: false,
    decided_by: "team",
    rule_name: "",
    rule_description: "",
  } satisfies McpResolvedToolPolicy;
}

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useGatewayToolPolicies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it("keeps the mutation result visible while invalidating inherited scopes", async () => {
    const stalePolicies = [policy("needs_approval")];
    const updatedPolicies = [policy("approved")];
    mocks.getPolicies.mockResolvedValue(stalePolicies);
    mocks.upsertPolicies.mockResolvedValue(updatedPolicies);

    const { result } = renderHook(
      () => useGatewayToolPolicies(serverId, TEAM_SCOPE),
      { wrapper },
    );

    await waitFor(() => expect(result.current.policies).toEqual(stalePolicies));

    const memberKey = gatewayKeys.tools(serverId, YOU_SCOPE);
    queryClient.setQueryData(memberKey, stalePolicies);

    act(() => {
      result.current.setPolicy({ toolName: "search", state: "approved" });
    });

    await waitFor(() =>
      expect(result.current.policies).toEqual(updatedPolicies),
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.getPolicies).toHaveBeenCalledTimes(1);
    expect(
      queryClient.getQueryData(gatewayKeys.tools(serverId, TEAM_SCOPE)),
    ).toEqual(updatedPolicies);
    expect(queryClient.getQueryState(memberKey)?.isInvalidated).toBe(true);
    expect(
      queryClient.getQueryState(gatewayKeys.tools(serverId, TEAM_SCOPE))
        ?.isInvalidated,
    ).toBe(false);
  });
});
