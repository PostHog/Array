import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RootLogger } from "@posthog/di/logger";
import type { IAnalytics } from "@posthog/platform/analytics";
import type { IWorkspaceSettings } from "@posthog/platform/workspace-settings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { WorkspaceService } from "./workspace";

const TASK_ID = "task-1";
const REPO_NAME = "posthog";
const WORKTREE_NAME = "plucky-summit-59";

function createService(worktreeBasePath: string) {
  const repositoryRepo = createMockRepositoryRepository();
  const workspaceRepo = createMockWorkspaceRepository();
  const worktreeRepo = createMockWorktreeRepository();

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

  const service = new WorkspaceService(
    {
      cancelSessionsByTaskId: vi.fn(async () => {}),
      onAgentFileActivity: vi.fn(),
    } satisfies WorkspaceAgent,
    { killByTaskId: vi.fn() } as unknown as ProcessTrackingService,
    repositoryRepo,
    workspaceRepo,
    worktreeRepo,
    {
      suspendLeastRecentIfOverLimit: vi.fn(async () => {}),
    } as unknown as SuspensionService,
    { emitOutput: vi.fn() } satisfies WorkspaceProvisioning,
    {
      stopWatching: vi.fn(async () => {}),
      onGitStateChanged: vi.fn(),
    } satisfies WorkspaceFileWatcher,
    { onBranchRenamed: vi.fn() } satisfies WorkspaceFocus,
    {
      getWorktreeLocation: () => worktreeBasePath,
    } as unknown as IWorkspaceSettings,
    { track: vi.fn() } as unknown as IAnalytics,
    log,
  );

  return { service, repositoryRepo, workspaceRepo, worktreeRepo };
}

describe("WorkspaceService.verifyWorkspaceExists", () => {
  let tmpDir: string;
  let worktreeBasePath: string;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "ws-verify-"));
    worktreeBasePath = path.join(tmpDir, "worktrees");
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it.each([
    { label: "existing worktree", createWorktree: true, expectExists: true },
    { label: "missing worktree", createWorktree: false, expectExists: false },
  ])(
    "$label: reports exists=$expectExists and never deletes the association",
    async ({ createWorktree, expectExists }) => {
      const { service, repositoryRepo, workspaceRepo, worktreeRepo } =
        createService(worktreeBasePath);

      const repoPath = path.join(tmpDir, REPO_NAME);
      const worktreePath = path.join(
        worktreeBasePath,
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
      expect(workspaceRepo.findByTaskId(TASK_ID)).not.toBeNull();
      expect(worktreeRepo.findByWorkspaceId(workspace.id)).not.toBeNull();
    },
  );

  it("reports a missing local folder without deleting the association", async () => {
    const { service, repositoryRepo, workspaceRepo } =
      createService(worktreeBasePath);

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
