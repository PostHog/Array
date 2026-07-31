import type {
  McpGatewayServer,
  McpServiceAccount,
} from "@posthog/api-client/posthog-client";
import { gatewayKeys } from "@posthog/ui/features/mcp-gateway/hooks/gatewayKeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAccounts: vi.fn(),
  setAccess: vi.fn(),
  infoToast: vi.fn(),
}));

vi.mock("@posthog/ui/features/auth/authClient", () => ({
  useOptionalAuthenticatedClient: () => ({
    getMcpServiceAccounts: mocks.getAccounts,
    setMcpServiceAccountAccess: mocks.setAccess,
  }),
}));

vi.mock("@posthog/ui/primitives/toast", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: mocks.infoToast,
  },
}));

import { useServiceAccounts } from "./useServiceAccounts";

const account = {
  id: "agent-1",
  name: "Support agent",
  description: "",
  handle: "posthog-support",
  status: "active",
  token_mask: "",
  server_ids: ["server-1"],
  last_active_at: null,
  created_at: "2026-07-23T12:00:00Z",
  updated_at: "2026-07-23T12:00:00Z",
} satisfies McpServiceAccount;

const server = {
  id: "server-1",
  agents: [
    {
      service_account_id: account.id,
      name: account.name,
      handle: account.handle,
      status: account.status,
      last_active_at: account.last_active_at,
      granted_by: null,
    },
  ],
} as McpGatewayServer;

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useServiceAccounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mocks.getAccounts.mockResolvedValue([account]);
    mocks.setAccess.mockResolvedValue({ ...account, server_ids: [] });
  });

  it("removes revoked agent access from both caches without a stale refetch", async () => {
    queryClient.setQueryData(gatewayKeys.servers, [server]);
    const { result } = renderHook(() => useServiceAccounts(), { wrapper });

    await waitFor(() => expect(result.current.accounts).toEqual([account]));

    act(() => {
      result.current.setAccess({
        accountId: account.id,
        serverId: server.id,
        enabled: false,
        successMessage: "Support agent no longer has access to Linear",
      });
    });

    await waitFor(() =>
      expect(result.current.accounts[0]?.server_ids).toEqual([]),
    );

    expect(
      queryClient.getQueryData<McpGatewayServer[]>(gatewayKeys.servers)?.[0]
        ?.agents,
    ).toEqual([]);
    expect(mocks.getAccounts).toHaveBeenCalledTimes(1);
    expect(mocks.infoToast).toHaveBeenCalledWith(
      "Support agent no longer has access to Linear",
    );
  });
});
