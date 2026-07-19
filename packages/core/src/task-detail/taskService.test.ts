import type { SessionService } from "@posthog/core/sessions/sessionService";
import type { RootLogger } from "@posthog/di/logger";
import { CLOUD_COMPUTER_USE_MCP_NAME } from "@posthog/shared";
import { describe, expect, it, vi } from "vitest";
import type { TaskCreationEffects } from "./taskCreationEffects";
import type { ITaskCreationHost } from "./taskCreationHost";
import { TaskCreationSaga } from "./taskCreationSaga";
import { buildWorktreeAdoptionInput } from "./taskInput";
import { TaskService } from "./taskService";

const scopedLog = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
const rootLogger = {
  ...scopedLog,
  scope: () => scopedLog,
} as unknown as RootLogger;

function makeService(options?: { computerUse?: boolean }): TaskService {
  const host = {
    // The API client's createTask rejects so tests can observe that an input
    // made it past validation (failedStep lands on task_creation, not
    // validation) without faking the whole saga.
    getAuthenticatedClient: vi.fn(async () => ({
      createTask: vi.fn().mockRejectedValue(new Error("api down")),
      deleteTask: vi.fn(),
      getTask: vi.fn(),
      createTaskRun: vi.fn(),
      startTaskRun: vi.fn(),
      sendRunCommand: vi.fn(),
      updateTask: vi.fn(),
    })),
    isComputerUseEnabled: vi.fn(() => options?.computerUse ?? false),
    detectRepo: vi.fn(async () => null),
    getFolders: vi.fn(async () => []),
    addFolder: vi.fn(async () => ({ id: "folder-1", path: "/repo" })),
    track: vi.fn(),
  } as unknown as ITaskCreationHost;
  const sessionService = {
    markTaskCreationInFlight: vi.fn(),
    connectToTask: vi.fn(),
    disconnectFromTask: vi.fn(),
  } as unknown as SessionService;
  const effects = {
    onWorkspaceCreated: vi.fn(),
    onCreateSuccess: vi.fn(),
  } as unknown as TaskCreationEffects;
  return new TaskService(host, sessionService, effects, rootLogger);
}

describe("TaskService.createTask validation", () => {
  it("rejects an input with neither content nor a taskDescription", async () => {
    const result = await makeService().createTask({
      content: "   ",
      repoPath: "/repo",
      workspaceMode: "worktree",
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected validation failure");
    expect(result.failedStep).toBe("validation");
  });

  it("accepts a promptless worktree-adoption input", async () => {
    const result = await makeService().createTask(
      buildWorktreeAdoptionInput({
        repoPath: "/repo",
        branch: "feature/orphan",
      }),
    );

    // The stubbed API call fails, proving the input got past validation.
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected task_creation failure");
    expect(result.failedStep).toBe("task_creation");
  });

  it("adds the computer-use relay to every cloud task", async () => {
    const run = vi.spyOn(TaskCreationSaga.prototype, "run").mockResolvedValue({
      success: false,
      error: "stop after input capture",
      failedStep: "task_creation",
    });

    await makeService({ computerUse: true }).createTask(
      {
        content: "Use my desktop",
        repository: "posthog/code",
        workspaceMode: "cloud",
      },
      undefined,
      { skipCloudUsagePreflight: true },
    );

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        relayedMcpServers: [{ name: CLOUD_COMPUTER_USE_MCP_NAME }],
      }),
    );
    run.mockRestore();
  });
});
