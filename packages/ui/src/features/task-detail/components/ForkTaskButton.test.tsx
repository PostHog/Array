import type { Task } from "@posthog/shared/domain-types";
import { Theme } from "@radix-ui/themes";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  forkTask: vi.fn(),
  invalidateTasks: vi.fn(),
  navigateToTaskDetail: vi.fn(),
  openTask: vi.fn(),
  setProvisioningFailed: vi.fn(),
  session: null as Record<string, unknown> | null,
  toast: vi.fn(),
  toastError: vi.fn(),
  useWorkspace: vi.fn(),
}));

vi.mock("@posthog/di/react", () => ({
  useService: () => ({ forkTask: mocks.forkTask }),
}));
vi.mock("@posthog/ui/features/workspace/useWorkspace", () => ({
  useWorkspace: mocks.useWorkspace,
}));
vi.mock("@posthog/ui/features/sessions/useSession", () => ({
  useSessionSelector: (
    _taskId: string,
    select: (session: Record<string, unknown> | undefined) => unknown,
  ) => select(mocks.session ?? undefined),
}));
vi.mock("@posthog/ui/router/navigationBridge", () => ({
  navigateToTaskDetail: mocks.navigateToTaskDetail,
}));
vi.mock("@posthog/ui/router/useOpenTask", () => ({
  openTask: mocks.openTask,
}));
vi.mock("@posthog/ui/features/tasks/useTaskCrudMutations", () => ({
  useCreateTask: () => ({ invalidateTasks: mocks.invalidateTasks }),
}));
vi.mock("@posthog/ui/features/provisioning/store", () => ({
  useProvisioningStore: {
    getState: () => ({ setFailed: mocks.setProvisioningFailed }),
  },
}));
vi.mock("@posthog/ui/features/notifications/errorDetails", () => ({
  toastError: mocks.toastError,
}));
vi.mock("@posthog/ui/primitives/Tooltip", () => ({
  Tooltip: ({
    children,
    content,
  }: {
    children: React.ReactNode;
    content: string;
  }) => <div data-tooltip={content}>{children}</div>,
}));
vi.mock("@posthog/ui/primitives/toast", () => ({
  toast: { error: mocks.toast },
}));

import { ForkedFromTaskButton, ForkTaskButton } from "./ForkTaskButton";

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
    mocks.session = null;
  });

  it("forks a completed cloud task and opens the child", async () => {
    const child = { id: "task-2" } as Task;
    mocks.forkTask.mockResolvedValue({
      success: true,
      data: { task: child, workspace: null },
    });

    render(
      <Theme>
        <ForkTaskButton task={cloudTask} />
      </Theme>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Fork task" }));

    await waitFor(() =>
      expect(mocks.forkTask).toHaveBeenCalledWith(
        cloudTask,
        expect.objectContaining({
          sourceRunStatus: "completed",
        }),
      ),
    );
    expect(mocks.invalidateTasks).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-2" }),
    );
    expect(mocks.openTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-2" }),
    );
    expect(mocks.navigateToTaskDetail).not.toHaveBeenCalledWith("task-2");
  });

  it("records and reports a provisioning failure on the child task", async () => {
    const child = { id: "task-2" } as Task;
    mocks.forkTask.mockResolvedValue({
      success: true,
      data: {
        task: child,
        workspace: null,
        provisioningError: "git checkout failed",
      },
    });

    render(
      <Theme>
        <ForkTaskButton task={cloudTask} />
      </Theme>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Fork task" }));

    await waitFor(() =>
      expect(mocks.setProvisioningFailed).toHaveBeenCalledWith(
        "task-2",
        "git checkout failed",
      ),
    );
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Failed to create workspace",
      "git checkout failed",
    );
  });

  it("reports a failed fork and leaves the button ready to retry", async () => {
    mocks.forkTask.mockResolvedValue({
      success: false,
      error: "fork failed",
      failedStep: "agent_session",
    });

    render(
      <Theme>
        <ForkTaskButton task={cloudTask} />
      </Theme>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Fork task" }));

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("Could not fork task", {
        description: "fork failed",
      }),
    );
    expect(screen.getByRole("button", { name: "Fork task" })).toBeEnabled();
    expect(mocks.openTask).not.toHaveBeenCalled();
  });

  it("reports a rejected fork and leaves the button ready to retry", async () => {
    mocks.forkTask.mockRejectedValue(new Error("network failed"));

    render(
      <Theme>
        <ForkTaskButton task={cloudTask} />
      </Theme>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Fork task" }));

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("Could not fork task", {
        description: "network failed",
      }),
    );
    expect(screen.getByRole("button", { name: "Fork task" })).toBeEnabled();
    expect(mocks.openTask).not.toHaveBeenCalled();
  });

  it("uses the live cloud status before the persisted run status", () => {
    mocks.session = { cloudStatus: "completed" };

    render(
      <Theme>
        <ForkTaskButton
          task={
            {
              ...cloudTask,
              latest_run: { ...cloudTask.latest_run, status: "in_progress" },
            } as Task
          }
        />
      </Theme>,
    );

    expect(screen.getByRole("button", { name: "Fork task" })).toBeEnabled();
  });

  it("disables Pi tasks with the runtime-specific reason", () => {
    render(
      <Theme>
        <ForkTaskButton task={{ ...cloudTask, runtime: "pi" } as Task} />
      </Theme>,
    );

    const button = screen.getByRole("button", { name: "Fork task" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button.closest("[data-tooltip]")).toHaveAttribute(
      "data-tooltip",
      "Pi tasks cannot be forked yet",
    );
  });

  it("disables scratch tasks as ineligible for local forking", () => {
    mocks.useWorkspace.mockReturnValue({ mode: "local", isScratch: true });
    mocks.session = { status: "connected", isPromptPending: false };

    render(
      <Theme>
        <ForkTaskButton
          task={
            {
              ...cloudTask,
              latest_run: { ...cloudTask.latest_run, environment: "local" },
            } as Task
          }
        />
      </Theme>,
    );

    const button = screen.getByRole("button", { name: "Fork task" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button.closest("[data-tooltip]")).toHaveAttribute(
      "data-tooltip",
      "Only repository-backed local tasks can be forked",
    );
  });

  it.each([
    {
      session: { status: "disconnected", isPromptPending: false },
      reason: "Reconnect the local task before forking it",
    },
    {
      session: { status: "connected", isPromptPending: true },
      reason: "Wait for the local task to finish before forking it",
    },
  ])("explains unavailable local state: $reason", ({ session, reason }) => {
    mocks.useWorkspace.mockReturnValue({ mode: "local", isScratch: false });
    mocks.session = session;

    render(
      <Theme>
        <ForkTaskButton
          task={
            {
              ...cloudTask,
              latest_run: { ...cloudTask.latest_run, environment: "local" },
            } as Task
          }
        />
      </Theme>,
    );

    const button = screen.getByRole("button", { name: "Fork task" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button.closest("[data-tooltip]")).toHaveAttribute(
      "data-tooltip",
      reason,
    );
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
