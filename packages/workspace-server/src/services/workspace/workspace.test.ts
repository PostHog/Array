import type { RootLogger } from "@posthog/di/logger";
import {
  branchExists,
  getCurrentBranch,
  getDefaultBranch,
  remoteBranchExists,
} from "@posthog/git/queries";
import type { IAnalytics } from "@posthog/platform/analytics";
import type { IWorkspaceSettings } from "@posthog/platform/workspace-settings";
import { ANALYTICS_EVENTS } from "@posthog/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRepositoryRepository } from "../../db/repositories/repository-repository.mock";
import { createMockWorkspaceRepository } from "../../db/repositories/workspace-repository.mock";
import { createMockWorktreeRepository } from "../../db/repositories/worktree-repository.mock";
import type { ProcessTrackingService } from "../process-tracking/process-tracking";
import type { SuspensionService } from "../suspension/suspension";
import type {
  WorkspaceAgent,
  WorkspaceFileWatcher,
  WorkspaceFocus,
  WorkspaceProvisioning,
} from "./ports";
import { WorkspaceService, WorkspaceServiceEvent } from "./workspace";

vi.mock("@posthog/git/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@posthog/git/queries")>();
  return {
    ...actual,
    getDefaultBranch: vi.fn(),
    getCurrentBranch: vi.fn(),
    branchExists: vi.fn(),
    remoteBranchExists: vi.fn(),
  };
});

function createMocks() {
  const agent = {
    cancelSessionsByTaskId: vi.fn(async () => {}),
    onAgentFileActivity: vi.fn(),
  } satisfies WorkspaceAgent;
  const processTracking = {
    killByTaskId: vi.fn(),
  } as unknown as ProcessTrackingService;
  const repositoryRepo = createMockRepositoryRepository();
  const workspaceRepo = createMockWorkspaceRepository();
  const worktreeRepo = createMockWorktreeRepository();
  const suspensionService = {
    suspendLeastRecentIfOverLimit: vi.fn(async () => {}),
  } as unknown as SuspensionService;
  const provisioning = {
    emitOutput: vi.fn(),
  } satisfies WorkspaceProvisioning;
  const fileWatcher = {
    stopWatching: vi.fn(async () => {}),
    onGitStateChanged: vi.fn(),
  } satisfies WorkspaceFileWatcher;
  const focus = {
    onBranchRenamed: vi.fn(),
  } satisfies WorkspaceFocus;
  const workspaceSettings = {
    getWorktreeLocation: () => "/tmp/worktrees",
  } as unknown as IWorkspaceSettings;
  const analytics = {
    track: vi.fn(),
  } as unknown as IAnalytics;
  const scopedLog = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const log: RootLogger = {
    ...scopedLog,
    scope: vi.fn(() => scopedLog),
  };

  return {
    agent,
    processTracking,
    repositoryRepo,
    workspaceRepo,
    worktreeRepo,
    suspensionService,
    provisioning,
    fileWatcher,
    focus,
    workspaceSettings,
    analytics,
    log,
  };
}

function makeService(mocks: ReturnType<typeof createMocks>): WorkspaceService {
  return new WorkspaceService(
    mocks.agent,
    mocks.processTracking,
    mocks.repositoryRepo,
    mocks.workspaceRepo,
    mocks.worktreeRepo,
    mocks.suspensionService,
    mocks.provisioning,
    mocks.fileWatcher,
    mocks.focus,
    mocks.workspaceSettings,
    mocks.analytics,
    mocks.log,
  );
}

describe("WorkspaceService", () => {
  let mocks: ReturnType<typeof createMocks>;
  let service: WorkspaceService;

  beforeEach(() => {
    mocks = createMocks();
    service = makeService(mocks);
  });

  describe("reconcileCloudWorkspaces", () => {
    it("creates only task ids that have no existing workspace, deduped", async () => {
      mocks.workspaceRepo.create({
        taskId: "existing",
        repositoryId: null,
        mode: "cloud",
      });
      const createCloudMany = vi.spyOn(mocks.workspaceRepo, "createCloudMany");

      const result = await service.reconcileCloudWorkspaces([
        "existing",
        "new-a",
        "new-a",
        "new-b",
      ]);

      expect(result.created.sort()).toEqual(["new-a", "new-b"]);
      expect(createCloudMany).toHaveBeenCalledWith(["new-a", "new-b"]);
    });

    it("returns empty and skips insert when nothing is new", async () => {
      const createCloudMany = vi.spyOn(mocks.workspaceRepo, "createCloudMany");

      const result = await service.reconcileCloudWorkspaces([]);

      expect(result.created).toEqual([]);
      expect(createCloudMany).not.toHaveBeenCalled();
    });
  });

  describe("linkBranch", () => {
    it("persists the link, emits LinkedBranchChanged, and tracks analytics", () => {
      const updateLinkedBranch = vi.spyOn(
        mocks.workspaceRepo,
        "updateLinkedBranch",
      );
      const emitted = vi.fn();
      service.on(WorkspaceServiceEvent.LinkedBranchChanged, emitted);

      service.linkBranch("task-1", "feature/x", "user");

      expect(updateLinkedBranch).toHaveBeenCalledWith("task-1", "feature/x");
      expect(emitted).toHaveBeenCalledWith({
        taskId: "task-1",
        branchName: "feature/x",
      });
      expect(mocks.analytics.track).toHaveBeenCalledWith(
        ANALYTICS_EVENTS.BRANCH_LINKED,
        expect.objectContaining({
          task_id: "task-1",
          branch_name: "feature/x",
          source: "user",
        }),
      );
    });
  });

  describe("unlinkBranch", () => {
    it("clears the link, emits LinkedBranchChanged null, and tracks analytics", () => {
      const updateLinkedBranch = vi.spyOn(
        mocks.workspaceRepo,
        "updateLinkedBranch",
      );
      const emitted = vi.fn();
      service.on(WorkspaceServiceEvent.LinkedBranchChanged, emitted);

      service.unlinkBranch("task-1", "user");

      expect(updateLinkedBranch).toHaveBeenCalledWith("task-1", null);
      expect(emitted).toHaveBeenCalledWith({
        taskId: "task-1",
        branchName: null,
      });
      expect(mocks.analytics.track).toHaveBeenCalledWith(
        ANALYTICS_EVENTS.BRANCH_UNLINKED,
        expect.objectContaining({ task_id: "task-1", source: "user" }),
      );
    });
  });

  describe("getWorkspace (cloud mode)", () => {
    it("projects a cloud workspace without touching git or fs", async () => {
      mocks.workspaceRepo.create({
        taskId: "cloud-task",
        repositoryId: "remote-repo",
        mode: "cloud",
      });

      const workspace = await service.getWorkspace("cloud-task");

      expect(workspace).toMatchObject({
        taskId: "cloud-task",
        folderId: "remote-repo",
        mode: "cloud",
        worktreePath: null,
        worktreeName: null,
        branchName: null,
      });
    });

    it("returns null when no workspace exists for the task", async () => {
      expect(await service.getWorkspace("missing")).toBeNull();
    });
  });

  describe("branch watcher wiring", () => {
    it("subscribes to each upstream source exactly once", () => {
      service.initBranchWatcher();
      service.initBranchWatcher();

      expect(mocks.fileWatcher.onGitStateChanged).toHaveBeenCalledTimes(1);
      expect(mocks.focus.onBranchRenamed).toHaveBeenCalledTimes(1);
      expect(mocks.agent.onAgentFileActivity).toHaveBeenCalledTimes(1);
    });
  });

  describe("checkWorktreeBranch", () => {
    const mainRepoPath = "/tmp/repo";

    beforeEach(() => {
      vi.mocked(getDefaultBranch).mockResolvedValue("main");
      vi.mocked(getCurrentBranch).mockResolvedValue("main");
      vi.mocked(branchExists).mockResolvedValue(false);
      vi.mocked(remoteBranchExists).mockResolvedValue(false);
    });

    it.each([
      { status: "trunk", branch: "main", local: false, remote: false },
      { status: "local", branch: "feature/x", local: true, remote: false },
      {
        status: "remote-only",
        branch: "feature/x",
        local: false,
        remote: true,
      },
      { status: "missing", branch: "feature/x", local: false, remote: false },
    ])(
      "classifies '$branch' as $status",
      async ({ status, branch, local, remote }) => {
        vi.mocked(branchExists).mockResolvedValue(local);
        vi.mocked(remoteBranchExists).mockResolvedValue(remote);

        expect(
          await service.checkWorktreeBranch({ mainRepoPath, branch }),
        ).toEqual({ status });
      },
    );

    it("falls back to the current branch as trunk when getDefaultBranch fails", async () => {
      vi.mocked(getDefaultBranch).mockRejectedValue(new Error("no remote"));
      vi.mocked(getCurrentBranch).mockResolvedValue("develop");

      expect(
        await service.checkWorktreeBranch({ mainRepoPath, branch: "develop" }),
      ).toEqual({ status: "trunk" });
    });
  });
});
