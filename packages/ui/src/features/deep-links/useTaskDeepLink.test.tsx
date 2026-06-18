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
  });

  it("opens a pending cold-start deep link through the bridge and navigates", async () => {
    getPendingDeepLink.mockResolvedValue({ taskId: "t1" });
    renderHook(() => useTaskDeepLink(), { wrapper });

    await waitFor(() => expect(openTask).toHaveBeenCalledWith("t1", undefined));
    await waitFor(() =>
      expect(routerOpenTask).toHaveBeenCalledWith({ id: "t1" }),
    );
    expect(markAsViewed).toHaveBeenCalledWith("t1");
  });

  it("subscribes to warm-start open-task events", () => {
    renderHook(() => useTaskDeepLink(), { wrapper });
    expect(onOpenTask).toHaveBeenCalledTimes(1);
  });
});
