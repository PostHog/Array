import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseService } from "../service";
import { createTestDb, type TestDatabase } from "../test-helpers";
import { TaskMetadataRepository } from "./task-metadata-repository";

let testDb: TestDatabase;
let repo: TaskMetadataRepository;

beforeEach(() => {
  testDb = createTestDb();
  const databaseService = { db: testDb.db } as unknown as DatabaseService;
  repo = new TaskMetadataRepository(databaseService);
});

afterEach(() => {
  testDb.close();
});

describe("TaskMetadataRepository pending initial prompt", () => {
  it("round-trips a pending initial prompt", () => {
    repo.upsert("task-1", { pendingInitialPrompt: '[{"type":"text"}]' });

    expect(repo.getPendingInitialPrompt("task-1")).toBe('[{"type":"text"}]');
  });

  it("returns null when nothing is stored", () => {
    expect(repo.getPendingInitialPrompt("missing")).toBeNull();
  });

  it("clears the pending prompt when set to null", () => {
    repo.upsert("task-1", { pendingInitialPrompt: '[{"type":"text"}]' });
    repo.upsert("task-1", { pendingInitialPrompt: null });

    expect(repo.getPendingInitialPrompt("task-1")).toBeNull();
  });

  it("does not wipe the pending prompt when other fields are upserted", () => {
    repo.upsert("task-1", { pendingInitialPrompt: '[{"type":"text"}]' });
    repo.upsert("task-1", { pinnedAt: "2026-07-13T00:00:00.000Z" });

    expect(repo.getPendingInitialPrompt("task-1")).toBe('[{"type":"text"}]');
    expect(repo.findByTaskId("task-1")?.pinnedAt).toBe(
      "2026-07-13T00:00:00.000Z",
    );
  });

  it("does not wipe other fields when the pending prompt is upserted", () => {
    repo.upsert("task-1", { pinnedAt: "2026-07-13T00:00:00.000Z" });
    repo.upsert("task-1", { pendingInitialPrompt: '[{"type":"text"}]' });

    expect(repo.findByTaskId("task-1")?.pinnedAt).toBe(
      "2026-07-13T00:00:00.000Z",
    );
    expect(repo.getPendingInitialPrompt("task-1")).toBe('[{"type":"text"}]');
  });
});
