import type { Task } from "@posthog/shared";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  forkTask: vi.fn(),
  openTask: vi.fn(),
  removeSeededTask: vi.fn(),
  seedTask: vi.fn(),
  setQueryData: vi.fn(),
  setProvisioningFailed: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@posthog/di/react", () => ({
  useService: () => ({ forkTask: mocks.forkTask }),
}));
vi.mock("@posthog/host-router/react", () => ({
  useHostTRPC: () => ({
    workspace: { getAll: { queryKey: () => ["workspace", "getAll"] } },
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ setQueryData: mocks.setQueryData }),
}));
vi.mock("@posthog/ui/features/tasks/useTaskCrudMutations", () => ({
  useCreateTask: () => ({
    removeSeededTask: mocks.removeSeededTask,
    seedTask: mocks.seedTask,
  }),
}));
vi.mock("@posthog/ui/features/provisioning/store", () => ({
  useProvisioningStore: {
    getState: () => ({ setFailed: mocks.setProvisioningFailed }),
  },
}));
vi.mock("@posthog/ui/features/notifications/errorDetails", () => ({
  toastError: vi.fn(),
}));
vi.mock("@posthog/ui/router/useOpenTask", () => ({
  openTask: mocks.openTask,
}));
vi.mock("@posthog/ui/primitives/toast", () => ({
  toast: { error: mocks.toast },
}));

import { useTaskFork } from "./useTaskFork";

const sourceTask = { id: "source", title: "Source" } as Task;
const childTask = { id: "child", title: "Child" } as Task;

describe("useTaskFork", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retains the child from task creation through final navigation", async () => {
    mocks.forkTask.mockImplementation(
      async (
        _task: Task,
        options: {
          onTaskReady: (output: {
            task: Task;
            workspace: { taskId: string; mode: string } | null;
          }) => void;
        },
      ) => {
        options.onTaskReady({ task: childTask, workspace: null });
        return {
          success: true,
          data: {
            task: childTask,
            workspace: { taskId: "child", mode: "worktree" },
          },
        };
      },
    );
    const { result } = renderHook(() => useTaskFork());

    await act(() => result.current.forkTask(sourceTask));

    expect(mocks.seedTask).toHaveBeenNthCalledWith(1, childTask);
    expect(mocks.seedTask).toHaveBeenNthCalledWith(2, childTask);
    expect(mocks.removeSeededTask).not.toHaveBeenCalled();
    expect(mocks.openTask).toHaveBeenCalledWith(childTask);
    expect(mocks.openTask.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.seedTask.mock.invocationCallOrder[1],
    );
  });

  it("removes the retained child when fork creation rolls back", async () => {
    mocks.forkTask.mockImplementation(
      async (
        _task: Task,
        options: { onTaskReady: (output: { task: Task }) => void },
      ) => {
        options.onTaskReady({ task: childTask });
        return { success: false, error: "fork failed" };
      },
    );
    const { result } = renderHook(() => useTaskFork());

    await act(() => result.current.forkTask(sourceTask));

    expect(mocks.removeSeededTask).toHaveBeenCalledWith("child");
    expect(mocks.openTask).not.toHaveBeenCalled();
  });
});
