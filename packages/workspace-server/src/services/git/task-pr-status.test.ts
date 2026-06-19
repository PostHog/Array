import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IWorkspaceRepository } from "../../db/repositories/workspace-repository";
import type { WorkspaceService } from "../workspace/workspace";
import type { GitService } from "./service";
import { TaskPrStatusService } from "./task-pr-status";

describe("TaskPrStatusService.getTaskPrStatus (missing worktree directory)", () => {
  let service: TaskPrStatusService;
  let gitService: {
    getDiffStats: ReturnType<typeof vi.fn>;
    getGitSyncStatus: ReturnType<typeof vi.fn>;
  };
  let workspaceService: {
    getWorkspace: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
  };
  let workspaceRepo: {
    findByTaskId: ReturnType<typeof vi.fn>;
    updatePrCache: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    gitService = { getDiffStats: vi.fn(), getGitSyncStatus: vi.fn() };
    workspaceService = { getWorkspace: vi.fn(), emit: vi.fn() };
    workspaceRepo = {
      findByTaskId: vi.fn().mockReturnValue(null),
      updatePrCache: vi.fn(),
    };
    service = new TaskPrStatusService(
      gitService as unknown as GitService,
      workspaceRepo as unknown as IWorkspaceRepository,
      workspaceService as unknown as WorkspaceService,
    );
  });

  it("returns no diff and never touches git when the worktree directory is gone", async () => {
    workspaceService.getWorkspace.mockResolvedValue({
      mode: "worktree",
      worktreePath: "/some/worktree",
      folderPath: null,
      linkedBranch: null,
    });
    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    const result = await service.getTaskPrStatus("task-1", null);
    await new Promise((resolve) => setImmediate(resolve));

    expect(result).toEqual({ prState: null, hasDiff: false });
    expect(gitService.getDiffStats).not.toHaveBeenCalled();
  });
});

describe("TaskPrStatusService revalidation PR detection", () => {
  let service: TaskPrStatusService;
  let gitService: {
    getPrStatus: ReturnType<typeof vi.fn>;
    getDiffStats: ReturnType<typeof vi.fn>;
    getGitSyncStatus: ReturnType<typeof vi.fn>;
    getPrUrlForBranch: ReturnType<typeof vi.fn>;
    getPrDetailsByUrl: ReturnType<typeof vi.fn>;
  };
  let workspaceService: {
    getWorkspace: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
  };
  let workspaceRepo: {
    findByTaskId: ReturnType<typeof vi.fn>;
    updatePrCache: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    gitService = {
      getPrStatus: vi.fn(),
      getDiffStats: vi.fn().mockResolvedValue({ filesChanged: 0 }),
      getGitSyncStatus: vi.fn().mockResolvedValue({ aheadOfDefault: 0 }),
      getPrUrlForBranch: vi.fn(),
      getPrDetailsByUrl: vi.fn(),
    };
    workspaceService = { getWorkspace: vi.fn(), emit: vi.fn() };
    workspaceRepo = {
      findByTaskId: vi.fn().mockReturnValue({ prUrl: null, prState: null }),
      updatePrCache: vi.fn(),
    };
    service = new TaskPrStatusService(
      gitService as unknown as GitService,
      workspaceRepo as unknown as IWorkspaceRepository,
      workspaceService as unknown as WorkspaceService,
    );
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
  });

  it("detects a PR on a local task's current branch even with no linked branch", async () => {
    workspaceService.getWorkspace.mockResolvedValue({
      mode: "local",
      worktreePath: null,
      folderPath: "/repo",
      linkedBranch: null,
    });
    gitService.getPrStatus.mockResolvedValue({
      prExists: true,
      prState: "open",
      prUrl: "https://github.com/acme/repo/pull/7",
      isDraft: false,
    });

    await service.getTaskPrStatus("task-local", null);
    await new Promise((resolve) => setImmediate(resolve));

    expect(gitService.getPrStatus).toHaveBeenCalledWith("/repo");
    expect(workspaceRepo.updatePrCache).toHaveBeenCalledWith("task-local", {
      prUrl: "https://github.com/acme/repo/pull/7",
      prState: "open",
    });
    expect(workspaceService.emit).toHaveBeenCalledWith("taskPrInfoChanged", {
      taskId: "task-local",
      prUrl: "https://github.com/acme/repo/pull/7",
      prState: "open",
    });
  });

  it("caches no PR for a local task whose branch has none, without checking diff", async () => {
    workspaceService.getWorkspace.mockResolvedValue({
      mode: "local",
      worktreePath: null,
      folderPath: "/repo",
      linkedBranch: null,
    });
    gitService.getPrStatus.mockResolvedValue({ prExists: false });

    await service.getTaskPrStatus("task-local", null);
    await new Promise((resolve) => setImmediate(resolve));

    expect(gitService.getPrStatus).toHaveBeenCalledWith("/repo");
    expect(gitService.getDiffStats).not.toHaveBeenCalled();
    expect(workspaceRepo.updatePrCache).toHaveBeenCalledWith("task-local", {
      prUrl: null,
      prState: null,
    });
  });

  it("still reports a worktree task's local diff when no PR exists", async () => {
    workspaceService.getWorkspace.mockResolvedValue({
      mode: "worktree",
      worktreePath: "/wt",
      folderPath: null,
      linkedBranch: null,
    });
    gitService.getPrStatus.mockResolvedValue({ prExists: false });
    gitService.getDiffStats.mockResolvedValue({ filesChanged: 3 });
    gitService.getGitSyncStatus.mockResolvedValue({ aheadOfDefault: 0 });

    await service.getTaskPrStatus("task-wt", null);
    await new Promise((resolve) => setImmediate(resolve));

    expect(gitService.getPrStatus).toHaveBeenCalledWith("/wt");
    expect(gitService.getDiffStats).toHaveBeenCalledWith("/wt");
    expect(workspaceRepo.updatePrCache).toHaveBeenCalledWith("task-wt", {
      prUrl: null,
      prState: null,
    });
  });
});
