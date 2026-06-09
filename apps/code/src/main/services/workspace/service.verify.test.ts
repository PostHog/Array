import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: (name: string) => {
      if (name === "home") return os.homedir();
      return os.tmpdir();
    },
  },
}));

let testWorktreeBasePath = "/tmp/worktrees";
vi.mock("../settingsStore", () => ({
  getWorktreeLocation: () => testWorktreeBasePath,
}));

// Stub modules that drag in electron / native deps but aren't used here.
vi.mock("../../di/container", () => ({ container: {} }));
vi.mock("@main/services/posthog-analytics", () => ({ trackAppEvent: vi.fn() }));
vi.mock("../focus/service", () => ({
  FocusService: class {},
  FocusServiceEvent: {},
}));

import { createMockRepositoryRepository } from "../../db/repositories/repository-repository.mock";
import { createMockWorkspaceRepository } from "../../db/repositories/workspace-repository.mock";
import { createMockWorktreeRepository } from "../../db/repositories/worktree-repository.mock";
import { WorkspaceService } from "./service";

const TASK_ID = "task-1";
const REPO_NAME = "posthog";
const WORKTREE_NAME = "plucky-summit-59";

function createService() {
  const repositoryRepo = createMockRepositoryRepository();
  const workspaceRepo = createMockWorkspaceRepository();
  const worktreeRepo = createMockWorktreeRepository();

  const service = new WorkspaceService();
  // WorkspaceService uses property injection; wire the repos in directly.
  Object.assign(service, {
    repositoryRepo,
    workspaceRepo,
    worktreeRepo,
  });

  return { service, repositoryRepo, workspaceRepo, worktreeRepo };
}

describe("WorkspaceService.verifyWorkspaceExists", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "ws-verify-"));
    testWorktreeBasePath = path.join(tmpDir, "worktrees");
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  // The worktree dir lives at the new layout <base>/<name>/<repo>.
  it.each([
    { label: "existing worktree", createWorktree: true, expectExists: true },
    { label: "missing worktree", createWorktree: false, expectExists: false },
  ])(
    "$label: reports exists=$expectExists and never deletes the association",
    async ({ createWorktree, expectExists }) => {
      const { service, repositoryRepo, workspaceRepo, worktreeRepo } =
        createService();

      const repoPath = path.join(tmpDir, REPO_NAME);
      const worktreePath = path.join(
        testWorktreeBasePath,
        WORKTREE_NAME,
        REPO_NAME,
      );
      await fsp.mkdir(repoPath, { recursive: true });
      if (createWorktree) await fsp.mkdir(worktreePath, { recursive: true });

      const repo = repositoryRepo.create({ path: repoPath });
      const workspace = workspaceRepo.create({
        taskId: TASK_ID,
        repositoryId: repo.id,
        mode: "worktree",
      });
      worktreeRepo.create({
        workspaceId: workspace.id,
        name: WORKTREE_NAME,
        path: worktreePath,
      });

      const result = await service.verifyWorkspaceExists(TASK_ID);

      expect(result.exists).toBe(expectExists);
      if (!expectExists) expect(result.missingPath).toContain(WORKTREE_NAME);
      // Association must survive so the task can recover later.
      expect(workspaceRepo.findByTaskId(TASK_ID)).not.toBeNull();
      expect(worktreeRepo.findByWorkspaceId(workspace.id)).not.toBeNull();
    },
  );

  it("reports a missing local folder without deleting the association", async () => {
    const { service, repositoryRepo, workspaceRepo } = createService();

    const repoPath = path.join(tmpDir, "gone");
    const repo = repositoryRepo.create({ path: repoPath });
    workspaceRepo.create({
      taskId: TASK_ID,
      repositoryId: repo.id,
      mode: "local",
    });

    const result = await service.verifyWorkspaceExists(TASK_ID);

    expect(result.exists).toBe(false);
    expect(result.missingPath).toBe(repoPath);
    expect(workspaceRepo.findByTaskId(TASK_ID)).not.toBeNull();
  });
});
