import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceMetadataService } from "./workspace-metadata";

const NOW_ISO = "2026-01-01T00:00:00.000Z";

function createService() {
  const repo = {
    findByTaskId: vi.fn(),
    findAll: vi.fn(),
    findAllPinned: vi.fn(),
    updatePinnedAt: vi.fn(),
    updateLastViewedAt: vi.fn(),
    updateLastActivityAt: vi.fn(),
  };
  const service = new WorkspaceMetadataService(repo as never);
  return { service, repo };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW_ISO));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WorkspaceMetadataService.togglePin", () => {
  it("returns an unpinned result and updates nothing when the workspace is missing", () => {
    const { service, repo } = createService();
    repo.findByTaskId.mockReturnValue(undefined);

    expect(service.togglePin("t1")).toEqual({
      isPinned: false,
      pinnedAt: null,
    });
    expect(repo.updatePinnedAt).not.toHaveBeenCalled();
  });

  it("pins an unpinned workspace with the current timestamp", () => {
    const { service, repo } = createService();
    repo.findByTaskId.mockReturnValue({ taskId: "t1", pinnedAt: null });

    expect(service.togglePin("t1")).toEqual({
      isPinned: true,
      pinnedAt: NOW_ISO,
    });
    expect(repo.updatePinnedAt).toHaveBeenCalledWith("t1", NOW_ISO);
  });

  it("unpins an already-pinned workspace", () => {
    const { service, repo } = createService();
    repo.findByTaskId.mockReturnValue({
      taskId: "t1",
      pinnedAt: "2025-01-01T00:00:00.000Z",
    });

    expect(service.togglePin("t1")).toEqual({
      isPinned: false,
      pinnedAt: null,
    });
    expect(repo.updatePinnedAt).toHaveBeenCalledWith("t1", null);
  });
});

describe("WorkspaceMetadataService.markViewed", () => {
  it("records the current time as the last viewed timestamp", () => {
    const { service, repo } = createService();
    service.markViewed("t1");
    expect(repo.updateLastViewedAt).toHaveBeenCalledWith("t1", NOW_ISO);
  });
});

describe("WorkspaceMetadataService.markActivity", () => {
  it("uses the current time when the last viewed time is in the past", () => {
    const { service, repo } = createService();
    repo.findByTaskId.mockReturnValue({
      taskId: "t1",
      lastViewedAt: "2020-01-01T00:00:00.000Z",
    });

    service.markActivity("t1");

    expect(repo.updateLastActivityAt).toHaveBeenCalledWith("t1", NOW_ISO);
  });

  it("clamps activity to one ms after a future last-viewed time", () => {
    const { service, repo } = createService();
    const future = "2027-01-01T00:00:00.000Z";
    repo.findByTaskId.mockReturnValue({ taskId: "t1", lastViewedAt: future });

    service.markActivity("t1");

    const expected = new Date(new Date(future).getTime() + 1).toISOString();
    expect(repo.updateLastActivityAt).toHaveBeenCalledWith("t1", expected);
  });

  it("falls back to the current time when there is no last viewed time", () => {
    const { service, repo } = createService();
    repo.findByTaskId.mockReturnValue({ taskId: "t1", lastViewedAt: null });

    service.markActivity("t1");

    expect(repo.updateLastActivityAt).toHaveBeenCalledWith("t1", NOW_ISO);
  });
});

describe("WorkspaceMetadataService projections", () => {
  it("returns the task ids of all pinned workspaces", () => {
    const { service, repo } = createService();
    repo.findAllPinned.mockReturnValue([{ taskId: "a" }, { taskId: "b" }]);

    expect(service.getPinnedTaskIds()).toEqual(["a", "b"]);
  });

  it("projects the timestamps for a task, defaulting missing values to null", () => {
    const { service, repo } = createService();
    repo.findByTaskId.mockReturnValue({
      taskId: "t1",
      pinnedAt: "2025-01-01T00:00:00.000Z",
      lastViewedAt: null,
      lastActivityAt: null,
    });

    expect(service.getTaskTimestamps("t1")).toEqual({
      pinnedAt: "2025-01-01T00:00:00.000Z",
      lastViewedAt: null,
      lastActivityAt: null,
    });
  });

  it("returns all-null timestamps for an unknown task", () => {
    const { service, repo } = createService();
    repo.findByTaskId.mockReturnValue(undefined);

    expect(service.getTaskTimestamps("missing")).toEqual({
      pinnedAt: null,
      lastViewedAt: null,
      lastActivityAt: null,
    });
  });

  it("builds a record of timestamps keyed by task id", () => {
    const { service, repo } = createService();
    repo.findAll.mockReturnValue([
      {
        taskId: "a",
        pinnedAt: "p",
        lastViewedAt: "v",
        lastActivityAt: "x",
      },
    ]);

    expect(service.getAllTaskTimestamps()).toEqual({
      a: { pinnedAt: "p", lastViewedAt: "v", lastActivityAt: "x" },
    });
  });
});
