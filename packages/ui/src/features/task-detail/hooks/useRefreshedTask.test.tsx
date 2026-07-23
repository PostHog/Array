import type { Task } from "@posthog/shared/domain-types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRefreshedTask } from "./useRefreshedTask";

const mocks = vi.hoisted(() => ({
  getTask: vi.fn(),
  useQuery: vi.fn(),
  actualUseQuery: undefined as unknown,
}));

vi.mock("@posthog/ui/features/auth/authClientImperative", () => ({
  getAuthenticatedClient: vi.fn(async () => ({ getTask: mocks.getTask })),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  // Keep a handle on the real useQuery so beforeEach can restore delegation
  // after a test overrides the mock's return value.
  mocks.actualUseQuery = actual.useQuery;
  return { ...actual, useQuery: mocks.useQuery };
});

function task(runId: string, status: "failed" | "in_progress"): Task {
  return {
    id: "task-123",
    title: "Cloud task",
    description: "Keep working",
    repository: null,
    latest_run: {
      id: runId,
      task: "task-123",
      environment: "cloud",
      status,
      state: {},
    },
  } as Task;
}

describe("useRefreshedTask", () => {
  beforeEach(() => {
    mocks.getTask.mockReset();
    mocks.useQuery.mockReset();
    // Delegate to the real useQuery by default; a test can override the return
    // value to simulate a specific cache state.
    mocks.useQuery.mockImplementation(
      mocks.actualUseQuery as typeof import("@tanstack/react-query").useQuery,
    );
  });

  it("falls back to initialTask when the query yields undefined data", () => {
    // A separate observer subscribing to the same query key without initialData
    // can create the cache entry first while the fetch is in flight, so React
    // Query hands this hook `data: undefined` despite the initialData option.
    // The hook must never surface undefined (it flows into getTaskRepository).
    mocks.useQuery.mockReturnValue({ data: undefined });
    const initialTask = task("run-parent", "in_progress");

    const { result } = renderHook(() =>
      useRefreshedTask("task-123", initialTask),
    );

    expect(result.current).toBe(initialTask);
  });

  it("replaces a cached failed run with the authoritative resumed run", async () => {
    const failedParent = task("run-parent", "failed");
    const resumedChild = task("run-child", "in_progress");
    mocks.getTask.mockResolvedValue(resumedChild);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () => useRefreshedTask("task-123", failedParent),
      { wrapper },
    );

    expect(result.current.latest_run?.id).toBe("run-parent");
    await waitFor(() => {
      expect(result.current.latest_run?.id).toBe("run-child");
    });
    expect(mocks.getTask).toHaveBeenCalledWith("task-123");
  });
});
