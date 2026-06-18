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

  it.each([
    { name: "plain list", filters: undefined, expectedLength: 1 },
    {
      name: "repository-scoped list",
      filters: { repository: "owner/repo" },
      expectedLength: 1,
    },
    {
      name: "slack-origin list",
      filters: { originProduct: "slack" },
      expectedLength: 0,
    },
  ])(
    "seeds the $name with the new task ($expectedLength entr(y/ies))",
    ({ filters, expectedLength }) => {
      const queryClient = new QueryClient();
      const key = taskKeys.list(filters);
      queryClient.setQueryData<Task[]>(key, []);

      const localWrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
      const { result } = renderHook(() => useCreateTask(), {
        wrapper: localWrapper,
      });

      result.current.invalidateTasks(createTask());

      // Origin-less lists mirror the new task; origin-scoped lists (read by the
      // sidebar to brand icons by id membership) must not be seeded.
      expect(queryClient.getQueryData<Task[]>(key)).toHaveLength(
        expectedLength,
      );
    },
  );

  it("still invalidates every list, including the slack-origin one", () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useCreateTask(), {
      wrapper: localWrapper,
    });

    result.current.invalidateTasks(createTask());

    // Seeding is scoped, but the refetch is not: all lists (slack included) are
    // invalidated so they reconcile with the server. A future refactor must not
    // "fix" the no-seed expectation above by dropping a list from refetch.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: taskKeys.lists() });
  });
});
