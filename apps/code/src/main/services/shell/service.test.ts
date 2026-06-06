import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShellEvent } from "./schemas";

const mockPty = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

const mockExec = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn(() => true));
const mockHomedir = vi.hoisted(() => vi.fn(() => "/home/testuser"));
const mockPlatform = vi.hoisted(() => vi.fn(() => "darwin"));

vi.mock("node-pty", () => mockPty);

vi.mock("node:child_process", () => ({
  exec: mockExec,
  default: { exec: mockExec },
}));

vi.mock("node:fs", () => ({
  existsSync: mockExistsSync,
  default: { existsSync: mockExistsSync },
}));

vi.mock("node:os", () => ({
  homedir: mockHomedir,
  platform: mockPlatform,
  default: { homedir: mockHomedir, platform: mockPlatform },
}));

vi.mock("../../utils/logger.js", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock("../../db/repositories/repository-repository.js", () => ({
  RepositoryRepository: vi.fn(),
}));

vi.mock("../../db/repositories/workspace-repository.js", () => ({
  WorkspaceRepository: vi.fn(),
}));

vi.mock("../../db/repositories/worktree-repository.js", () => ({
  WorktreeRepository: vi.fn(),
}));

vi.mock("../settingsStore.js", () => ({
  getWorktreeLocation: vi.fn(() => "/tmp/worktrees"),
}));

vi.mock("../workspace/workspaceEnv.js", () => ({
  buildWorkspaceEnv: vi.fn(() => ({})),
}));

vi.mock("../../utils/process-utils.js", () => ({
  killProcessTree: vi.fn(),
  isProcessAlive: vi.fn(() => true),
}));

vi.mock("../../di/tokens.js", () => ({
  MAIN_TOKENS: {
    ProcessTrackingService: Symbol.for("Main.ProcessTrackingService"),
    RepositoryRepository: Symbol.for("Main.RepositoryRepository"),
    WorkspaceRepository: Symbol.for("Main.WorkspaceRepository"),
    WorktreeRepository: Symbol.for("Main.WorktreeRepository"),
  },
}));

import type { RepositoryRepository } from "../../db/repositories/repository-repository";
import type { WorkspaceRepository } from "../../db/repositories/workspace-repository";
import type { WorktreeRepository } from "../../db/repositories/worktree-repository";
import type { ProcessTrackingService } from "../process-tracking/service";
import { ShellService } from "./service";

function createMockProcessTracking(): ProcessTrackingService {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    getAll: vi.fn(() => []),
    getByCategory: vi.fn(() => []),
    getSnapshot: vi.fn(),
    discoverChildren: vi.fn(),
    isAlive: vi.fn(() => true),
    kill: vi.fn(),
    killByCategory: vi.fn(),
    killAll: vi.fn(),
  } as unknown as ProcessTrackingService;
}

function createMockRepositoryRepo(): RepositoryRepository {
  return {
    findById: vi.fn(),
    findByPath: vi.fn(),
    findAll: vi.fn(() => []),
    create: vi.fn(),
    upsertByPath: vi.fn(),
    updateLastAccessed: vi.fn(),
    delete: vi.fn(),
  } as unknown as RepositoryRepository;
}

function createMockWorkspaceRepo(): WorkspaceRepository {
  return {
    findActiveByTaskId: vi.fn(() => null),
    findArchivedByTaskId: vi.fn(),
    findAllActive: vi.fn(() => []),
    findAllArchived: vi.fn(() => []),
    findAllActiveByRepositoryId: vi.fn(() => []),
    createActive: vi.fn(),
    archive: vi.fn(),
    unarchive: vi.fn(),
    deleteByTaskId: vi.fn(),
    updatePinnedAt: vi.fn(),
    updateLastViewedAt: vi.fn(),
  } as unknown as WorkspaceRepository;
}

function createMockWorktreeRepo(): WorktreeRepository {
  return {
    findById: vi.fn(),
    findByWorkspaceId: vi.fn(() => null),
    findByPath: vi.fn(),
    findAll: vi.fn(() => []),
    create: vi.fn(),
    updateBranch: vi.fn(),
    deleteByWorkspaceId: vi.fn(),
  } as unknown as WorktreeRepository;
}

describe("ShellService", () => {
  let service: ShellService;
  let mockPtyProcess: {
    onData: ReturnType<typeof vi.fn>;
    onExit: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    process: string;
  };

  let mockProcessTracking: ProcessTrackingService;
  let mockRepositoryRepo: RepositoryRepository;
  let mockWorkspaceRepo: WorkspaceRepository;
  let mockWorktreeRepo: WorktreeRepository;

  const createMockDisposable = () => ({ dispose: vi.fn() });

  beforeEach(() => {
    vi.clearAllMocks();

    mockPtyProcess = {
      onData: vi.fn(() => createMockDisposable()),
      onExit: vi.fn(() => createMockDisposable()),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      destroy: vi.fn(),
      process: "/bin/bash",
    };

    mockPty.spawn.mockReturnValue(mockPtyProcess);
    mockExistsSync.mockReturnValue(true);
    mockProcessTracking = createMockProcessTracking();
    mockRepositoryRepo = createMockRepositoryRepo();
    mockWorkspaceRepo = createMockWorkspaceRepo();
    mockWorktreeRepo = createMockWorktreeRepo();

    service = new ShellService(
      mockProcessTracking,
      mockRepositoryRepo,
      mockWorkspaceRepo,
      mockWorktreeRepo,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [
      "interactive shell session",
      () => service.create("session-1", "/home/user/project"),
    ],
    [
      "command session",
      () =>
        service.createCommandSession({
          sessionId: "session-1",
          command: "echo hello",
          cwd: "/home/user/project",
        }),
    ],
  ])("spawns %s with UTF-8 output decoding", async (_name, createSession) => {
    await createSession();

    expect(mockPty.spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        encoding: "utf8",
      }),
    );
  });

  describe("create", () => {
    it("creates a new shell session", async () => {
      await service.create("session-1", "/home/user/project");

      expect(mockPty.spawn).toHaveBeenCalledWith(
        expect.any(String),
        ["-l"],
        expect.objectContaining({
          name: "xterm-256color",
          cols: 80,
          rows: 24,
          cwd: "/home/user/project",
        }),
      );
    });

    it("uses home directory when cwd not specified", async () => {
      await service.create("session-1");

      expect(mockPty.spawn).toHaveBeenCalledWith(
        expect.any(String),
        ["-l"],
        expect.objectContaining({
          cwd: "/home/testuser",
        }),
      );
    });

    it("falls back to home when cwd does not exist", async () => {
      mockExistsSync.mockReturnValue(false);

      await service.create("session-1", "/nonexistent/path");

      expect(mockPty.spawn).toHaveBeenCalledWith(
        expect.any(String),
        ["-l"],
        expect.objectContaining({
          cwd: "/home/testuser",
        }),
      );
    });

    it("does not recreate existing session", async () => {
      await service.create("session-1", "/home/user");
      await service.create("session-1", "/different/path");

      expect(mockPty.spawn).toHaveBeenCalledTimes(1);
    });

    it("emits data events from pty", async () => {
      const dataHandler = vi.fn();
      service.on(ShellEvent.Data, dataHandler);

      await service.create("session-1");

      // Get the onData callback and call it
      const onDataCallback = mockPtyProcess.onData.mock.calls[0][0];
      onDataCallback("test output");

      expect(dataHandler).toHaveBeenCalledWith({
        sessionId: "session-1",
        data: "test output",
      });
    });

    it("emits exit events from pty", async () => {
      const exitHandler = vi.fn();
      service.on(ShellEvent.Exit, exitHandler);

      await service.create("session-1");

      // Get the onExit callback and call it
      const onExitCallback = mockPtyProcess.onExit.mock.calls[0][0];
      onExitCallback({ exitCode: 0 });

      expect(exitHandler).toHaveBeenCalledWith({
        sessionId: "session-1",
        exitCode: 0,
      });
    });

    it("cleans up session on exit", async () => {
      await service.create("session-1");
      expect(service.check("session-1")).toBe(true);

      // Simulate exit
      const onExitCallback = mockPtyProcess.onExit.mock.calls[0][0];
      onExitCallback({ exitCode: 0 });

      expect(service.check("session-1")).toBe(false);
    });

    it("sets TERM_PROGRAM environment variable", async () => {
      await service.create("session-1");

      expect(mockPty.spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({
            TERM_PROGRAM: "PostHog Code",
            COLORTERM: "truecolor",
            FORCE_COLOR: "3",
          }),
        }),
      );
    });
  });

  describe("write", () => {
    it("writes data to session", async () => {
      await service.create("session-1");

      service.write("session-1", "ls -la\n");

      expect(mockPtyProcess.write).toHaveBeenCalledWith("ls -la\n");
    });

    it("throws error for non-existent session", () => {
      expect(() => service.write("nonexistent", "data")).toThrow(
        "Shell session nonexistent not found",
      );
    });
  });

  describe("resize", () => {
    it("resizes session terminal", async () => {
      await service.create("session-1");

      service.resize("session-1", 120, 40);

      expect(mockPtyProcess.resize).toHaveBeenCalledWith(120, 40);
    });

    it("throws error for non-existent session", () => {
      expect(() => service.resize("nonexistent", 80, 24)).toThrow(
        "Shell session nonexistent not found",
      );
    });
  });

  describe("check", () => {
    it("returns true for existing session", async () => {
      await service.create("session-1");

      expect(service.check("session-1")).toBe(true);
    });

    it("returns false for non-existent session", () => {
      expect(service.check("nonexistent")).toBe(false);
    });
  });

  describe("destroy", () => {
    it("disposes listeners, destroys pty, and removes session", async () => {
      await service.create("session-1");

      service.destroy("session-1");

      expect(mockPtyProcess.destroy).toHaveBeenCalled();
      expect(service.check("session-1")).toBe(false);
    });

    it("emits an exit event for explicit teardown", async () => {
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
      expect(() => service.destroy("nonexistent")).not.toThrow();
    });
  });

  describe("getProcess", () => {
    it("returns process name for existing session", async () => {
      await service.create("session-1");

      expect(service.getProcess("session-1")).toBe("/bin/bash");
    });

    it("returns null for non-existent session", () => {
      expect(service.getProcess("nonexistent")).toBeNull();
    });
  });

  describe("execute", () => {
    it("executes command and returns output", async () => {
      mockExec.mockImplementation((_cmd, _opts, callback) => {
        callback(null, "command output", "");
      });

      const result = await service.execute("/home/user", "echo hello");

      expect(result).toEqual({
        stdout: "command output",
        stderr: "",
        exitCode: 0,
      });
    });

    it("returns stderr on command errors", async () => {
      mockExec.mockImplementation((_cmd, _opts, callback) => {
        callback({ code: 1 }, "", "error message");
      });

      const result = await service.execute("/home/user", "bad-command");

      expect(result).toEqual({
        stdout: "",
        stderr: "error message",
        exitCode: 1,
      });
    });

    it("handles command timeout", async () => {
      mockExec.mockImplementation((_cmd, opts, callback) => {
        // Verify timeout is set
        expect(opts.timeout).toBe(60000);
        callback(null, "output", "");
      });

      await service.execute("/home/user", "slow-command");

      expect(mockExec).toHaveBeenCalledWith(
        "slow-command",
        expect.objectContaining({
          cwd: "/home/user",
          timeout: 60000,
        }),
        expect.any(Function),
      );
    });

    it("returns empty strings when stdout/stderr are undefined", async () => {
      mockExec.mockImplementation((_cmd, _opts, callback) => {
        callback(null, undefined, undefined);
      });

      const result = await service.execute("/home/user", "silent-command");

      expect(result).toEqual({
        stdout: "",
        stderr: "",
        exitCode: 0,
      });
    });
  });

  describe("platform-specific behavior", () => {
    it("uses SHELL env on Unix", async () => {
      const originalShell = process.env.SHELL;
      process.env.SHELL = "/bin/zsh";
      mockPlatform.mockReturnValue("darwin");

      await service.create("session-1");

      expect(mockPty.spawn).toHaveBeenCalledWith(
        "/bin/zsh",
        expect.any(Array),
        expect.any(Object),
      );

      process.env.SHELL = originalShell;
    });

    it("falls back to /bin/bash when SHELL not set", async () => {
      const originalShell = process.env.SHELL;
      delete process.env.SHELL;
      mockPlatform.mockReturnValue("darwin");

      const newService = new ShellService(
        mockProcessTracking,
        mockRepositoryRepo,
        mockWorkspaceRepo,
        mockWorktreeRepo,
      );
      await newService.create("session-1");

      expect(mockPty.spawn).toHaveBeenCalledWith(
        "/bin/bash",
        expect.any(Array),
        expect.any(Object),
      );

      process.env.SHELL = originalShell;
    });
  });

  describe("multiple sessions", () => {
    it("manages multiple independent sessions", async () => {
      const mockPty1 = { ...mockPtyProcess, process: "bash-1" };
      const mockPty2 = { ...mockPtyProcess, process: "bash-2" };

      mockPty.spawn.mockReturnValueOnce(mockPty1).mockReturnValueOnce(mockPty2);

      await service.create("session-1", "/path/1");
      await service.create("session-2", "/path/2");

      expect(service.check("session-1")).toBe(true);
      expect(service.check("session-2")).toBe(true);
      expect(service.getProcess("session-1")).toBe("bash-1");
      expect(service.getProcess("session-2")).toBe("bash-2");
    });

    it("destroys sessions independently", async () => {
      mockPty.spawn.mockReturnValue({ ...mockPtyProcess });

      await service.create("session-1");
      await service.create("session-2");

      service.destroy("session-1");

      expect(service.check("session-1")).toBe(false);
      expect(service.check("session-2")).toBe(true);
    });
  });
});
