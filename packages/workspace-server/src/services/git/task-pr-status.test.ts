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
