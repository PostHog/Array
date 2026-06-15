import type { Task } from "@posthog/shared/domain-types";
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

import { taskKeys } from "./taskKeys";
import { useCreateTask, useDeleteTask } from "./useTaskCrudMutations";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient();
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "new-task",
    task_number: 1,
    slug: "new-task",
    title: "New task",
    description: "New task",
    created_at: "2026-06-15T00:00:00.000Z",
    updated_at: "2026-06-15T00:00:00.000Z",
    origin_product: "user_created",
    ...overrides,
  };
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

describe("useCreateTask.invalidateTasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("seeds plain list caches but not the slack-origin list", () => {
    const queryClient = new QueryClient();
    const plainKey = taskKeys.list();
    const slackKey = taskKeys.list({ originProduct: "slack" });
    queryClient.setQueryData<Task[]>(plainKey, []);
    queryClient.setQueryData<Task[]>(slackKey, []);

    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useCreateTask(), {
      wrapper: localWrapper,
    });

    result.current.invalidateTasks(createTask());

    // The new, non-slack task lands in the plain list...
    expect(queryClient.getQueryData<Task[]>(plainKey)).toHaveLength(1);
    // ...but never pollutes the slack-origin list, which the sidebar reads to
    // brand task icons by id membership.
    expect(queryClient.getQueryData<Task[]>(slackKey)).toHaveLength(0);
  });
});
