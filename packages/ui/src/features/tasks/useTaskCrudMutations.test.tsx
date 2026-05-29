import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mutateAsync = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const confirmAndDelete = vi.hoisted(() =>
  vi.fn(
    async (
      _options: { taskId: string; taskTitle: string; hasWorktree: boolean },
      runDelete: (taskId: string) => Promise<unknown>,
    ) => {
      await runDelete(_options.taskId);
      return true;
    },
  ),
);
const deletionService = vi.hoisted(() => ({
  deleteTask: vi.fn().mockResolvedValue(undefined),
  confirmAndDelete,
}));

vi.mock("@posthog/ui/hooks/useAuthenticatedMutation", () => ({
  useAuthenticatedMutation: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("@posthog/di/react", () => ({
  useService: () => deletionService,
}));

import { useDeleteTask } from "./useTaskCrudMutations";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient();
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useDeleteTask.deleteWithConfirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to the deletion service with the delete mutation", async () => {
    const { result } = renderHook(() => useDeleteTask(), { wrapper });

    const ok = await result.current.deleteWithConfirm({
      taskId: "t1",
      taskTitle: "Title",
      hasWorktree: true,
    });

    expect(ok).toBe(true);
    expect(confirmAndDelete).toHaveBeenCalledWith(
      { taskId: "t1", taskTitle: "Title", hasWorktree: true },
      mutateAsync,
    );
    expect(mutateAsync).toHaveBeenCalledWith("t1");
  });

  it("returns false when the service reports the user declined", async () => {
    confirmAndDelete.mockResolvedValueOnce(false);
    const { result } = renderHook(() => useDeleteTask(), { wrapper });

    const ok = await result.current.deleteWithConfirm({
      taskId: "t1",
      taskTitle: "Title",
      hasWorktree: false,
    });

    expect(ok).toBe(false);
  });
});
