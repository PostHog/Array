import type { Task } from "@posthog/shared/domain-types";
import { Theme } from "@radix-ui/themes";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  forkTask: vi.fn(),
  navigateToTaskDetail: vi.fn(),
  useWorkspace: vi.fn(),
  useSessionForTask: vi.fn(),
}));

vi.mock("@posthog/di/react", () => ({
  useService: () => ({ forkTask: mocks.forkTask }),
}));
vi.mock("@posthog/ui/features/workspace/useWorkspace", () => ({
  useWorkspace: mocks.useWorkspace,
}));
vi.mock("@posthog/ui/features/sessions/useSession", () => ({
  useSessionForTask: mocks.useSessionForTask,
}));
vi.mock("@posthog/ui/router/navigationBridge", () => ({
  navigateToTaskDetail: mocks.navigateToTaskDetail,
}));
vi.mock("@posthog/ui/primitives/Tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@posthog/ui/primitives/toast", () => ({
  toast: { error: vi.fn() },
}));

import { ForkTaskButton, ForkedFromTaskButton } from "./ForkTaskButton";

const cloudTask = {
  id: "task-1",
  title: "Source task",
  latest_run: {
    id: "run-1",
    environment: "cloud",
    status: "completed",
    state: {},
  },
} as Task;

describe("ForkTaskButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useWorkspace.mockReturnValue({ mode: "cloud" });
    mocks.useSessionForTask.mockReturnValue(null);
  });

  it("forks a completed cloud task and opens the child", async () => {
    mocks.forkTask.mockImplementation(
      async (_task: Task, onReady: (output: { task: Task }) => void) => {
        onReady({ task: { id: "task-2" } as Task });
        return { success: true, data: {} };
      },
    );

    render(
      <Theme>
        <ForkTaskButton task={cloudTask} />
      </Theme>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Fork task" }));

    await waitFor(() => expect(mocks.forkTask).toHaveBeenCalledWith(cloudTask, expect.any(Function)));
    expect(mocks.navigateToTaskDetail).toHaveBeenCalledWith("task-2");
  });

  it("links a forked task back to its source", () => {
    const child = {
      ...cloudTask,
      latest_run: {
        ...cloudTask.latest_run,
        state: { forked_from_task_id: "task-parent" },
      },
    } as Task;

    render(
      <Theme>
        <ForkedFromTaskButton task={child} />
      </Theme>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open source task" }));

    expect(mocks.navigateToTaskDetail).toHaveBeenCalledWith("task-parent");
  });
});
