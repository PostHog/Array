import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseService } from "../service";
import { createTestDb, type TestDatabase } from "../test-helpers";
import { TaskMetadataRepository } from "./task-metadata-repository";
import { WorkspaceRepository } from "./workspace-repository";

// Round-trips labels through real SQLite (createTestDb applies the full
// migration chain), so a broken 0023_task_labels migration fails here rather
// than on first launch.

let testDb: TestDatabase;
let workspaces: WorkspaceRepository;
let taskMetadata: TaskMetadataRepository;

beforeEach(() => {
  testDb = createTestDb();
  const databaseService = { db: testDb.db } as unknown as DatabaseService;
  workspaces = new WorkspaceRepository(databaseService);
  taskMetadata = new TaskMetadataRepository(databaseService);
});

afterEach(() => {
  testDb.close();
});

describe("workspace label persistence", () => {
  it("stores, reads back, and clears a label on the workspace row", () => {
    workspaces.create({ taskId: "t1", repositoryId: null, mode: "cloud" });
    expect(workspaces.findByTaskId("t1")?.label).toBeNull();

    workspaces.updateLabel("t1", "high-priority");
    expect(workspaces.findByTaskId("t1")?.label).toBe("high-priority");

    workspaces.updateLabel("t1", null);
    expect(workspaces.findByTaskId("t1")?.label).toBeNull();
  });
});

describe("task_metadata label persistence (rowless tasks)", () => {
  it("stores, reads back, and clears a label", () => {
    taskMetadata.upsert("t1", { label: "done" });
    expect(taskMetadata.findByTaskId("t1")?.label).toBe("done");

    taskMetadata.upsert("t1", { label: null });
    expect(taskMetadata.findByTaskId("t1")?.label).toBeNull();
  });

  it("keeps the label when other metadata fields are patched", () => {
    taskMetadata.upsert("t1", { label: "active" });
    taskMetadata.upsert("t1", { lastViewedAt: "2026-01-01T00:00:00.000Z" });
    expect(taskMetadata.findByTaskId("t1")?.label).toBe("active");
  });
});
