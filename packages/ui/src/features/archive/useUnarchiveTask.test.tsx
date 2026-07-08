import type {
  ContextMenuOutcome,
  DeleteOutcome,
  RestoreOutcome,
} from "@posthog/core/archive/archivedTasksController";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_QUERY_KEY } from "../workspace/identifiers";

const ARCHIVE_FILTER = { queryKey: [["archive"]] };

const controller = vi.hoisted(() => ({
  restore: vi.fn(),
  remove: vi.fn(),
  runContextMenuAction: vi.fn(),
}));

vi.mock("@posthog/di/react", () => ({
  useService: () => controller,
}));

vi.mock("@posthog/host-router/react", () => ({
  useHostTRPC: () => ({
    archive: {
      pathFilter: () => ARCHIVE_FILTER,
    },
  }),
}));

import { useUnarchiveTask } from "./useUnarchiveTask";

let queryClient: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useUnarchiveTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it("invalidates the workspace query when an archived task is deleted", async () => {
    // Regression: the delete path once skipped WORKSPACE_QUERY_KEY, so the
    // sidebar kept showing deleted archived tasks. Pin the invalidation here so
    // the restore/delete sets can't silently drift apart again.
    controller.remove.mockResolvedValue({ kind: "deleted" } as DeleteOutcome);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUnarchiveTask(), { wrapper });

    await act(async () => {
      await result.current.remove("t1");
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: WORKSPACE_QUERY_KEY,
    });
  });

  it("does not invalidate when deletion fails", async () => {
    controller.remove.mockResolvedValue({
      kind: "error",
      message: "nope",
    } as DeleteOutcome);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUnarchiveTask(), { wrapper });

    await act(async () => {
      await result.current.remove("t1");
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("invalidates the workspace query when a task is restored", async () => {
    controller.restore.mockResolvedValue({
      kind: "restored",
      navigateToTaskId: "t1",
    } as RestoreOutcome);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUnarchiveTask(), { wrapper });

    await act(async () => {
      await result.current.restore("t1", true);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: WORKSPACE_QUERY_KEY,
    });
  });

  it("invalidates the workspace query when the context menu deletes a task", async () => {
    controller.runContextMenuAction.mockResolvedValue({
      kind: "delete",
      outcome: { kind: "deleted" },
    } as ContextMenuOutcome);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUnarchiveTask(), { wrapper });

    await act(async () => {
      await result.current.runContextMenuAction("t1", "Task 1", true);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: WORKSPACE_QUERY_KEY,
    });
  });
});
