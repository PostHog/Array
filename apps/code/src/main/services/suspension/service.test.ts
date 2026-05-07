import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetAutoSuspendEnabled = vi.hoisted(() => vi.fn(() => true));
const mockGetMaxActiveWorktrees = vi.hoisted(() => vi.fn(() => 5));
const mockGetAutoSuspendAfterDays = vi.hoisted(() => vi.fn(() => 7));
const mockCaptureRun = vi.hoisted(() => vi.fn(() => ({ success: true })));
const mockDeleteCheckpoint = vi.hoisted(() => vi.fn());
const mockCreateGitClient = vi.hoisted(() =>
  vi.fn(() => ({ revparse: vi.fn(() => "feat/test\n") })),
);
const mockWorktreeManagerProto = vi.hoisted(() => ({
  deleteWorktree: vi.fn(),
  createWorktreeForExistingBranch: vi.fn(),
  createDetachedWorktreeAtCommit: vi.fn(),
}));

vi.mock("../settingsStore.js", () => ({
  getAutoSuspendEnabled: mockGetAutoSuspendEnabled,
  getMaxActiveWorktrees: mockGetMaxActiveWorktrees,
  getAutoSuspendAfterDays: mockGetAutoSuspendAfterDays,
  setAutoSuspendEnabled: vi.fn(),
  setMaxActiveWorktrees: vi.fn(),
  setAutoSuspendAfterDays: vi.fn(),
  getWorktreeLocation: vi.fn(() => "/tmp/worktrees"),
}));

vi.mock("@posthog/git/client", () => ({
  createGitClient: mockCreateGitClient,
}));
vi.mock("@posthog/git/sagas/checkpoint", () => ({
  CaptureCheckpointSaga: class {
    run = mockCaptureRun;
  },
  RevertCheckpointSaga: class {
    run = vi.fn(() => ({ success: true }));
  },
  deleteCheckpoint: mockDeleteCheckpoint,
}));
vi.mock("@posthog/git/worktree", () => ({
  WorktreeManager: class {
    deleteWorktree = mockWorktreeManagerProto.deleteWorktree;
    createWorktreeForExistingBranch =
      mockWorktreeManagerProto.createWorktreeForExistingBranch;
    createDetachedWorktreeAtCommit =
      mockWorktreeManagerProto.createDetachedWorktreeAtCommit;
  },
}));
vi.mock("node:fs/promises", () => {
  const fns = {
    rm: vi.fn(),
    access: vi.fn(),
    lstat: vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
      ),
    chmod: vi.fn(),
    readdir: vi.fn().mockResolvedValue([]),
  };
  return { default: fns, ...fns };
});

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

vi.mock("../../di/tokens.js", () => ({
  MAIN_TOKENS: {
    AgentService: Symbol.for("Main.AgentService"),
    ProcessTrackingService: Symbol.for("Main.ProcessTrackingService"),
    FileWatcherService: Symbol.for("Main.FileWatcherService"),
    RepositoryRepository: Symbol.for("Main.RepositoryRepository"),
    WorkspaceRepository: Symbol.for("Main.WorkspaceRepository"),
    WorktreeRepository: Symbol.for("Main.WorktreeRepository"),
    SuspensionRepository: Symbol.for("Main.SuspensionRepository"),
    ArchiveRepository: Symbol.for("Main.ArchiveRepository"),
  },
}));

import { createMockArchiveRepository } from "../../db/repositories/archive-repository.mock.js";
import { createMockRepositoryRepository } from "../../db/repositories/repository-repository.mock.js";
import { createMockSuspensionRepository } from "../../db/repositories/suspension-repository.mock.js";
import type { Workspace } from "../../db/repositories/workspace-repository.js";
import { createMockWorkspaceRepository } from "../../db/repositories/workspace-repository.mock.js";
import { createMockWorktreeRepository } from "../../db/repositories/worktree-repository.mock.js";
import type { AgentService } from "../agent/service.js";
import type { FileWatcherService } from "../file-watcher/service.js";
import type { ProcessTrackingService } from "../process-tracking/service.js";
import { SuspensionService } from "./service.js";

function createMocks() {
  const agentService = {
    cancelSessionsByTaskId: vi.fn(),
  } as unknown as AgentService;
  const processTracking = {
    killByTaskId: vi.fn(),
  } as unknown as ProcessTrackingService;
  const fileWatcher = {
    stopWatching: vi.fn(),
  } as unknown as FileWatcherService;
  const repositoryRepo = createMockRepositoryRepository();
  const workspaceRepo = createMockWorkspaceRepository();
  const worktreeRepo = createMockWorktreeRepository();
  const suspensionRepo = createMockSuspensionRepository();
  const archiveRepo = createMockArchiveRepository();

  repositoryRepo.create({ path: "/repo", id: "repo-1" });

  return {
    agentService,
    processTracking,
    fileWatcher,
    repositoryRepo,
    workspaceRepo,
    worktreeRepo,
    suspensionRepo,
    archiveRepo,
  };
}

function makeService(mocks: ReturnType<typeof createMocks>) {
  return new SuspensionService(
    mocks.agentService,
    mocks.processTracking,
    mocks.fileWatcher,
    mocks.repositoryRepo,
    mocks.workspaceRepo,
    mocks.worktreeRepo,
    mocks.suspensionRepo,
    mocks.archiveRepo,
  );
}

function seedWorktreeWorkspace(
  mocks: ReturnType<typeof createMocks>,
  overrides: Partial<Workspace> = {},
) {
  const ws = mocks.workspaceRepo.create({
    taskId: overrides.taskId ?? "task-1",
    repositoryId: overrides.repositoryId ?? "repo-1",
    mode: overrides.mode ?? "worktree",
  });
  const stored = mocks.workspaceRepo._workspaces.get(ws.id);
  if (!stored) throw new Error(`Workspace not found: ${ws.id}`);
  if (overrides.lastActivityAt !== undefined)
    stored.lastActivityAt = overrides.lastActivityAt;
  if (overrides.createdAt !== undefined) stored.createdAt = overrides.createdAt;
  const resolved = mocks.workspaceRepo.findById(ws.id);
  if (!resolved) throw new Error(`Workspace not found: ${ws.id}`);
  mocks.worktreeRepo.create({
    workspaceId: resolved.id,
    name: `wt-${resolved.taskId}`,
    path: `/tmp/worktrees/wt-${resolved.taskId}/repo`,
  });
  return resolved;
}

describe("SuspensionService", () => {
  let mocks: ReturnType<typeof createMocks>;
  let service: SuspensionService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAutoSuspendEnabled.mockImplementation(() => true);
    mockGetMaxActiveWorktrees.mockImplementation(() => 5);
    mockGetAutoSuspendAfterDays.mockImplementation(() => 7);
    mocks = createMocks();
    service = makeService(mocks);
  });

  afterEach(() => {
    service.stopInactivityChecker();
  });

  describe("getActiveWorktreeWorkspaces filtering", () => {
    beforeEach(() => mockGetMaxActiveWorktrees.mockReturnValue(1));

    it.each([
      [
        "non-worktree mode",
        (m: ReturnType<typeof createMocks>) =>
          seedWorktreeWorkspace(m, { mode: "local" }),
      ],
      [
        "already-suspended",
        (m: ReturnType<typeof createMocks>) => {
          const ws = seedWorktreeWorkspace(m);
          m.suspensionRepo.create({
            workspaceId: ws.id,
            branchName: null,
            checkpointId: null,
            reason: "manual",
          });
        },
      ],
      [
        "archived",
        (m: ReturnType<typeof createMocks>) => {
          const ws = seedWorktreeWorkspace(m);
          m.archiveRepo.create({
            workspaceId: ws.id,
            branchName: null,
            checkpointId: null,
          });
        },
      ],
    ])("excludes %s workspaces", async (_label, setup) => {
      setup(mocks);
      await service.suspendLeastRecentIfOverLimit();
      expect(
        mocks.suspensionRepo
          .findAll()
          .filter((s) => s.reason === "max_worktrees"),
      ).toHaveLength(0);
    });
  });

  describe("suspendLeastRecentIfOverLimit", () => {
    it("does nothing when autoSuspendEnabled is false", async () => {
      mockGetAutoSuspendEnabled.mockReturnValue(false);
      seedWorktreeWorkspace(mocks);
      await service.suspendLeastRecentIfOverLimit();
      expect(mocks.suspensionRepo.findAll()).toHaveLength(0);
    });

    it("does nothing when active count is below the limit", async () => {
      seedWorktreeWorkspace(mocks);
      await service.suspendLeastRecentIfOverLimit();
      expect(mocks.suspensionRepo.findAll()).toHaveLength(0);
    });

    it.each([
      [
        "lastActivityAt",
        "2024-01-01T00:00:00.000Z",
        "2024-06-01T00:00:00.000Z",
      ],
      ["createdAt fallback", null, null],
    ])(
      "suspends the oldest workspace by %s",
      async (_label, oldActivity, newActivity) => {
        const older = seedWorktreeWorkspace(mocks, {
          taskId: "task-old",
          lastActivityAt: oldActivity,
          createdAt: "2024-01-01T00:00:00.000Z",
        });
        seedWorktreeWorkspace(mocks, {
          taskId: "task-new",
          lastActivityAt: newActivity,
          createdAt: "2024-06-01T00:00:00.000Z",
        });
        mockGetMaxActiveWorktrees.mockReturnValue(1);

        await service.suspendLeastRecentIfOverLimit();

        const suspended = mocks.suspensionRepo.findAll();
        expect(suspended).toHaveLength(1);
        expect(suspended[0].workspaceId).toBe(older.id);
      },
    );
  });

  describe("suspendInactiveWorktrees", () => {
    it("does not suspend recently active worktrees", async () => {
      seedWorktreeWorkspace(mocks, {
        lastActivityAt: new Date().toISOString(),
      });
      await service.suspendInactiveWorktrees();
      expect(mocks.suspensionRepo.findAll()).toHaveLength(0);
    });

    it.each([
      ["lastActivityAt", "2020-01-01T00:00:00.000Z", undefined],
      ["createdAt fallback", null, "2020-01-01T00:00:00.000Z"],
    ])(
      "suspends stale worktrees using %s",
      async (_label, lastActivityAt, createdAt) => {
        seedWorktreeWorkspace(mocks, {
          lastActivityAt,
          ...(createdAt ? { createdAt } : {}),
        });

        await service.suspendInactiveWorktrees();

        const suspended = mocks.suspensionRepo.findAll();
        expect(suspended).toHaveLength(1);
        expect(suspended[0].reason).toBe("inactivity");
      },
    );
  });

  describe("withRollback", () => {
    it("propagates the error and does not persist suspension", async () => {
      seedWorktreeWorkspace(mocks);
      mocks.suspensionRepo = createMockSuspensionRepository({
        failOnCreate: true,
      });
      service = makeService(mocks);

      await expect(service.suspendTask("task-1", "manual")).rejects.toThrow(
        "Injected failure on suspension create",
      );
      expect(mocks.suspensionRepo.findAll()).toHaveLength(0);
    });
  });
});
