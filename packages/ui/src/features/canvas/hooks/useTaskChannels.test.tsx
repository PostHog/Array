import type { TaskChannel } from "@posthog/shared/domain-types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockClient = vi.hoisted(() => ({
  getTaskChannels: vi.fn(),
  resolveTaskChannel: vi.fn(),
  renameTaskChannel: vi.fn(),
}));
vi.mock("@posthog/ui/features/auth/authClient", () => ({
  useOptionalAuthenticatedClient: () => mockClient,
}));
vi.mock("@posthog/ui/primitives/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import {
  TASK_CHANNELS_QUERY_KEY,
  useRenameBackendChannel,
} from "./useTaskChannels";

function taskChannel(
  id: string,
  name: string,
  channel_type: "public" | "personal" = "public",
): TaskChannel {
  return { id, name, channel_type, created_at: "2026-01-01T00:00:00Z" };
}

let queryClient: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useRenameBackendChannel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it("renames the matching public channel to the normalized new name", async () => {
    // Cache is populated (channel on screen) — the race-free synchronous path.
    queryClient.setQueryData<TaskChannel[]>(TASK_CHANNELS_QUERY_KEY, [
      taskChannel("c1", "harley"),
    ]);
    mockClient.renameTaskChannel.mockResolvedValue(
      taskChannel("c1", "team-workflows"),
    );

    const { result } = renderHook(() => useRenameBackendChannel(), { wrapper });
    await act(async () => {
      await result.current("harley", "Team Workflows");
    });

    expect(mockClient.renameTaskChannel).toHaveBeenCalledWith(
      "c1",
      "team-workflows",
    );
    expect(
      queryClient.getQueryData<TaskChannel[]>(TASK_CHANNELS_QUERY_KEY)?.[0]
        .name,
    ).toBe("team-workflows");
    expect(mockClient.getTaskChannels).not.toHaveBeenCalled();
  });

  it("falls back to a fetch when the channels cache is empty", async () => {
    mockClient.getTaskChannels.mockResolvedValue([taskChannel("c1", "harley")]);
    mockClient.renameTaskChannel.mockResolvedValue(
      taskChannel("c1", "team-workflows"),
    );

    const { result } = renderHook(() => useRenameBackendChannel(), { wrapper });
    await act(async () => {
      await result.current("harley", "team-workflows");
    });

    expect(mockClient.getTaskChannels).toHaveBeenCalled();
    expect(mockClient.renameTaskChannel).toHaveBeenCalledWith(
      "c1",
      "team-workflows",
    );
  });

  it("no-ops when there is no matching backend channel", async () => {
    mockClient.getTaskChannels.mockResolvedValue([]);

    const { result } = renderHook(() => useRenameBackendChannel(), { wrapper });
    await act(async () => {
      await result.current("harley", "team-workflows");
    });

    expect(mockClient.renameTaskChannel).not.toHaveBeenCalled();
  });

  it("no-ops for the personal channel and for unchanged names", async () => {
    queryClient.setQueryData<TaskChannel[]>(TASK_CHANNELS_QUERY_KEY, [
      taskChannel("p1", "me", "personal"),
      taskChannel("c1", "harley"),
    ]);

    const { result } = renderHook(() => useRenameBackendChannel(), { wrapper });
    await act(async () => {
      await result.current("me", "team-workflows"); // personal → never renamed
      await result.current("harley", "Harley"); // normalizes to same name
    });

    expect(mockClient.renameTaskChannel).not.toHaveBeenCalled();
  });

  it("rolls back the optimistic cache rename when the PATCH fails", async () => {
    queryClient.setQueryData<TaskChannel[]>(TASK_CHANNELS_QUERY_KEY, [
      taskChannel("c1", "harley"),
    ]);
    mockClient.renameTaskChannel.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useRenameBackendChannel(), { wrapper });
    await act(async () => {
      await result.current("harley", "team-workflows");
    });

    // Never throws, and the cache is restored to the original name.
    expect(
      queryClient.getQueryData<TaskChannel[]>(TASK_CHANNELS_QUERY_KEY)?.[0]
        .name,
    ).toBe("harley");
  });
});
