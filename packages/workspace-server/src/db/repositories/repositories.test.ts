import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseService } from "../service";
import { createTestDb, type TestDatabase } from "../test-helpers";
import { RepositoryRepository } from "./repository-repository";
import { WorkspaceRepository } from "./workspace-repository";
import { WorktreeRepository } from "./worktree-repository";

let testDb: TestDatabase;
let repositories: RepositoryRepository;
let workspaces: WorkspaceRepository;
let worktrees: WorktreeRepository;

beforeEach(() => {
  testDb = createTestDb();
  const databaseService = { db: testDb.db } as unknown as DatabaseService;
  repositories = new RepositoryRepository(databaseService);
  workspaces = new WorkspaceRepository(databaseService);
  worktrees = new WorktreeRepository(databaseService);
});

afterEach(() => {
  testDb.close();
});

describe("RepositoryRepository round-trip", () => {
  it("persists a created repository and reads it back by id", () => {
    const created = repositories.create({
      path: "/repos/twig",
      remoteUrl: "posthog/twig",
    });

    const found = repositories.findById(created.id);

    expect(found).not.toBeNull();
    expect(found?.path).toBe("/repos/twig");
    expect(found?.remoteUrl).toBe("posthog/twig");
  });

  it("finds a repository by path", () => {
    const created = repositories.create({ path: "/repos/twig" });

    expect(repositories.findByPath("/repos/twig")?.id).toBe(created.id);
  });

  it("updates the remote url in place", () => {
    const created = repositories.create({ path: "/repos/twig" });

    repositories.updateRemoteUrl(created.id, "posthog/twig");

    expect(repositories.findById(created.id)?.remoteUrl).toBe("posthog/twig");
  });

  it("removes a deleted repository from reads", () => {
    const created = repositories.create({ path: "/repos/twig" });

    repositories.delete(created.id);

    expect(repositories.findById(created.id)).toBeNull();
  });
});

describe("repository → workspace → worktree round-trip", () => {
  it("persists the full ownership chain across repositories", () => {
    const repository = repositories.create({ path: "/repos/twig" });

    const workspace = workspaces.create({
      taskId: "task-1",
      repositoryId: repository.id,
      mode: "worktree",
    });

    const worktree = worktrees.create({
      workspaceId: workspace.id,
      name: "feature-branch",
      path: "/worktrees/twig/feature-branch",
    });

    expect(workspaces.findByTaskId("task-1")?.repositoryId).toBe(repository.id);
    expect(worktrees.findByWorkspaceId(workspace.id)?.id).toBe(worktree.id);
    expect(workspaces.findAllByRepositoryId(repository.id)).toHaveLength(1);
  });
});
