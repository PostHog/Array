import type { ArchivedTask } from "@posthog/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ArchiveOrchestrationDeps,
  archiveTask,
  archiveTasks,
  shouldNavigateAwayForBulkArchive,
} from "./archiveOrchestration";

const TASK_ID = "task-1";

class Harness {
  ids: string[] = [];
  list: ArchivedTask[] = [];
  deps: ArchiveOrchestrationDeps = {
    getWorkspace: vi.fn().mockResolvedValue(null),
    getPinnedTaskIds: vi.fn().mockResolvedValue([]),
    unpin: vi.fn().mockResolvedValue(undefined),
    togglePin: vi.fn().mockResolvedValue(undefined),
    navigateAwayFromTaskIfActive: vi.fn(),
    snapshotTerminalStates: vi.fn().mockReturnValue({}),
    clearTerminalStates: vi.fn(),
    restoreTerminalStates: vi.fn(),
    snapshotCommandCenter: vi
      .fn()
      .mockReturnValue({ index: -1, wasActive: false }),
    removeFromCommandCenter: vi.fn(),
    restoreCommandCenter: vi.fn(),
    getFocusedWorktreePath: vi.fn().mockReturnValue(null),
    disableFocus: vi.fn().mockResolvedValue(undefined),
    disconnectFromTask: vi.fn().mockResolvedValue(undefined),
    archive: vi.fn().mockResolvedValue(undefined),
    logError: vi.fn(),
    cache: {
      cancelPathFilter: vi.fn().mockResolvedValue(undefined),
      invalidatePathFilter: vi.fn(),
      setArchivedTaskIds: (updater) => {
        this.ids = updater(this.ids);
      },
      setArchiveList: (updater) => {
        this.list = updater(this.list);
      },
    },
  };
}

function makeDeps(): Harness {
  return new Harness();
}

describe("archiveTask", () => {
  let harness: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    harness = makeDeps();
  });

  it("optimistically adds the task to both archive caches and calls archive", async () => {
    await archiveTask(TASK_ID, harness.deps);

    expect(harness.deps.archive).toHaveBeenCalledWith(TASK_ID);
    expect(harness.deps.disconnectFromTask).toHaveBeenCalledWith(TASK_ID);
    expect(harness.ids).toContain(TASK_ID);
    expect(harness.list.some((a) => a.taskId === TASK_ID)).toBe(true);
  });

  it("with optimistic:false, defers cache writes until archive resolves", async () => {
    let idsWhenArchiveCalled: string[] = ["sentinel"];
    harness.deps.archive = vi.fn().mockImplementation(async () => {
      // Snapshot the cache at the moment the request is made — the row must
      // still be present (not yet marked archived) while it's in flight.
      idsWhenArchiveCalled = [...harness.ids];
    });

    await archiveTask(TASK_ID, harness.deps, { optimistic: false });

    expect(idsWhenArchiveCalled).not.toContain(TASK_ID);
    // Once the archive resolves, the row is removed from the list.
    expect(harness.ids).toContain(TASK_ID);
    expect(harness.list.some((a) => a.taskId === TASK_ID)).toBe(true);
  });

  it("with optimistic:false, leaves caches untouched when archive fails", async () => {
    harness.deps.getPinnedTaskIds = vi.fn().mockResolvedValue([TASK_ID]);
    harness.deps.archive = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(
      archiveTask(TASK_ID, harness.deps, { optimistic: false }),
    ).rejects.toThrow("boom");

    expect(harness.ids).not.toContain(TASK_ID);
    expect(harness.list).toEqual([]);
    expect(harness.deps.togglePin).toHaveBeenCalledWith(TASK_ID);
  });

  it("rolls back caches and re-pins when archive fails", async () => {
    harness.deps.getPinnedTaskIds = vi.fn().mockResolvedValue([TASK_ID]);
    harness.deps.archive = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(archiveTask(TASK_ID, harness.deps)).rejects.toThrow("boom");

    expect(harness.ids).not.toContain(TASK_ID);
    expect(harness.list).toEqual([]);
    expect(harness.deps.togglePin).toHaveBeenCalledWith(TASK_ID);
  });
});

describe("archiveTasks", () => {
  it("tallies archived and failed counts", async () => {
    const harness = makeDeps();
    harness.deps.archive = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("boom"));

    const result = await archiveTasks(["a", "b"], harness.deps);

    expect(result).toEqual({ archived: 1, failed: 1 });
  });

  it("returns zeros for an empty list", async () => {
    const harness = makeDeps();
    expect(await archiveTasks([], harness.deps)).toEqual({
      archived: 0,
      failed: 0,
    });
  });
});

describe("shouldNavigateAwayForBulkArchive", () => {
  it("is true when the active task is in the archive set", () => {
    expect(shouldNavigateAwayForBulkArchive(["a", "b"], "b")).toBe(true);
  });

  it("is false when the active task is absent", () => {
    expect(shouldNavigateAwayForBulkArchive(["a"], "z")).toBe(false);
  });

  it("is false when there is no active task", () => {
    expect(shouldNavigateAwayForBulkArchive(["a"], null)).toBe(false);
  });
});
