import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShellEvent } from "./schemas";

const mockPty = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("node-pty", () => mockPty);

const mockGitQueries = vi.hoisted(() => ({
  getCurrentBranch: vi.fn(async () => "feature-branch"),
  getDefaultBranch: vi.fn(async () => "main"),
}));

vi.mock("@posthog/git/queries", () => mockGitQueries);

import { ShellService } from "./shell";

function createMockPtyProcess() {
  return {
    pid: 1234,
    process: "bash",
    write: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onExit: vi.fn(() => ({ dispose: vi.fn() })),
  };
}

function createService(overrides?: {
  repositoryRepo?: unknown;
  workspaceRepo?: unknown;
  worktreeRepo?: unknown;
}) {
  const processTracking = {
    register: vi.fn(),
    unregister: vi.fn(),
    kill: vi.fn(),
  };
  const logger = {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
  const service = new ShellService(
    processTracking as never,
    (overrides?.repositoryRepo ?? {}) as never,
    (overrides?.workspaceRepo ?? {}) as never,
    (overrides?.worktreeRepo ?? {}) as never,
    { getWorktreeLocation: vi.fn(() => "/tmp/worktrees") } as never,
    logger as never,
  );
  return { service, processTracking };
}

describe("ShellService.destroy", () => {
  it("emits an exit event for explicit teardown", async () => {
    mockPty.spawn.mockReturnValue(createMockPtyProcess());
    const { service } = createService();
    const exitHandler = vi.fn();
    service.on(ShellEvent.Exit, exitHandler);

    await service.create("session-1");

    service.destroy("session-1");

    expect(exitHandler).toHaveBeenCalledWith({
      sessionId: "session-1",
      exitCode: 130,
    });
  });

  it("does nothing for non-existent session", () => {
    const { service } = createService();
    expect(() => service.destroy("nonexistent")).not.toThrow();
  });
});

describe("ShellService.createSession workspace env", () => {
  function createWorktreeTaskService(worktreePath: string) {
    return createService({
      workspaceRepo: {
        findByTaskId: vi.fn(() => ({
          id: "ws-1",
          mode: "worktree",
          repositoryId: "repo-1",
        })),
      },
      repositoryRepo: {
        findById: vi.fn(() => ({ id: "repo-1", path: "/repos/code" })),
      },
      worktreeRepo: {
        findByWorkspaceId: vi.fn(() => ({
          id: "wt-1",
          workspaceId: "ws-1",
          name: "spawn-tasks",
          path: worktreePath,
        })),
      },
    });
  }

  function spawnedEnv(): Record<string, string> {
    return mockPty.spawn.mock.calls[0][2].env;
  }

  let tempDir: string;

  beforeEach(() => {
    mockPty.spawn.mockReset();
    mockPty.spawn.mockReturnValue(createMockPtyProcess());
    mockGitQueries.getCurrentBranch.mockResolvedValue("feature-branch");
    mockGitQueries.getDefaultBranch.mockResolvedValue("main");
    tempDir = mkdtempSync(path.join(tmpdir(), "shell-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("uses the stored worktree path when it exists on disk", async () => {
    const { service } = createWorktreeTaskService(tempDir);

    await service.createSession({
      sessionId: "session-1",
      cwd: tempDir,
      taskId: "task-1",
    });

    expect(spawnedEnv().POSTHOG_CODE_WORKSPACE_PATH).toBe(tempDir);
    expect(mockGitQueries.getCurrentBranch).toHaveBeenCalledWith(tempDir);
  });

  it("falls back to the derived path when the stored path is missing", async () => {
    const { service } = createWorktreeTaskService("/does/not/exist");

    await service.createSession({
      sessionId: "session-1",
      cwd: tempDir,
      taskId: "task-1",
    });

    expect(spawnedEnv().POSTHOG_CODE_WORKSPACE_PATH).toBe(
      path.join("/tmp/worktrees", "spawn-tasks", "code"),
    );
  });

  it("still creates the shell when env construction fails", async () => {
    mockGitQueries.getDefaultBranch.mockRejectedValue(
      new Error("Cannot use simple-git on a directory that does not exist"),
    );
    const { service } = createWorktreeTaskService(tempDir);

    await expect(
      service.createSession({
        sessionId: "session-1",
        cwd: tempDir,
        taskId: "task-1",
      }),
    ).resolves.toBeDefined();

    expect(mockPty.spawn).toHaveBeenCalledTimes(1);
    expect(spawnedEnv().POSTHOG_CODE_WORKSPACE_PATH).toBeUndefined();
  });
});
