import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openTask = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    success: true,
    data: { task: { id: "t1" }, workspace: null },
  }),
);
const getPendingDeepLink = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const onOpenTask = vi.hoisted(() => vi.fn(() => ({ unsubscribe: vi.fn() })));
const routerOpenTask = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const markAsViewed = vi.hoisted(() => vi.fn());
const bluebirdState = vi.hoisted(() => ({ enabled: true }));
const channelMapState = vi.hoisted(() => ({
  map: new Map<string, { id: string; name: string; path: string }>(),
}));

vi.mock("@posthog/host-router/react", () => ({
  useHostTRPCClient: () => ({
    deepLink: {
      getPendingDeepLink: { query: getPendingDeepLink },
      onOpenTask: { subscribe: onOpenTask },
    },
  }),
}));
vi.mock("@posthog/ui/features/auth/store", () => ({
  useAuthStateValue: (sel: (s: { status: string }) => unknown) =>
    sel({ status: "authenticated" }),
}));
vi.mock("@posthog/ui/router/useOpenTask", () => ({
  openTask: routerOpenTask,
}));
vi.mock("@posthog/ui/features/sidebar/useTaskViewed", () => ({
  useTaskViewed: () => ({ markAsViewed }),
}));
vi.mock("@posthog/di/react", () => ({
  useService: () => ({ openTask }),
}));
vi.mock("@posthog/ui/shell/logger", () => ({
  logger: { scope: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));
vi.mock("@posthog/ui/primitives/toast", () => ({
  toast: { error: vi.fn() },
}));
vi.mock("@posthog/ui/features/feature-flags/useFeatureFlag", () => ({
  useFeatureFlag: () => bluebirdState.enabled,
}));
vi.mock("@posthog/ui/features/canvas/hooks/useChannels", () => ({
  useChannels: () => ({ channels: [], isLoading: false }),
}));
vi.mock("@posthog/ui/features/canvas/hooks/useTaskChannelMap", () => ({
  useTaskChannelMap: () => channelMapState.map,
}));

import { useTaskDeepLink } from "./useTaskDeepLink";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useTaskDeepLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPendingDeepLink.mockResolvedValue(null);
    bluebirdState.enabled = true;
    channelMapState.map = new Map();
  });

  it("opens a pending cold-start deep link through the bridge and navigates", async () => {
    getPendingDeepLink.mockResolvedValue({ taskId: "t1" });
    renderHook(() => useTaskDeepLink(), { wrapper });

    await waitFor(() => expect(openTask).toHaveBeenCalledWith("t1", undefined));
    await waitFor(() =>
      expect(routerOpenTask).toHaveBeenCalledWith({ id: "t1" }, undefined),
    );
    expect(markAsViewed).toHaveBeenCalledWith("t1");
  });

  it("routes a channel-filed task to its channel view", async () => {
    channelMapState.map = new Map([
      ["t1", { id: "chan-1", name: "marketing", path: "/marketing" }],
    ]);
    getPendingDeepLink.mockResolvedValue({ taskId: "t1" });
    renderHook(() => useTaskDeepLink(), { wrapper });

    await waitFor(() =>
      expect(routerOpenTask).toHaveBeenCalledWith(
        { id: "t1" },
        { channelId: "chan-1" },
      ),
    );
  });

  it("ignores channel membership when the bluebird flag is off", async () => {
    bluebirdState.enabled = false;
    channelMapState.map = new Map([
      ["t1", { id: "chan-1", name: "marketing", path: "/marketing" }],
    ]);
    getPendingDeepLink.mockResolvedValue({ taskId: "t1" });
    renderHook(() => useTaskDeepLink(), { wrapper });

    await waitFor(() =>
      expect(routerOpenTask).toHaveBeenCalledWith({ id: "t1" }, undefined),
    );
  });

  it("subscribes to warm-start open-task events", () => {
    renderHook(() => useTaskDeepLink(), { wrapper });
    expect(onOpenTask).toHaveBeenCalledTimes(1);
  });
});
