import { describe, expect, it } from "vitest";
import type { TaskData } from "../hooks/useSidebarData";
import { applyRevisitFilter } from "./applyRevisitFilter";

function makeTask(overrides: Partial<TaskData> = {}): TaskData {
  return {
    id: "task-1",
    title: "Test task",
    createdAt: 1,
    lastActivityAt: 1,
    isGenerating: false,
    isUnread: false,
    isPinned: false,
    needsPermission: false,
    repository: null,
    isSuspended: false,
    folderPath: null,
    cloudPrUrl: null,
    branchName: null,
    linkedBranch: null,
    ...overrides,
  };
}

describe("applyRevisitFilter", () => {
  it("returns input unchanged when showRevisitOnly is false", () => {
    const tasks = [makeTask({ id: "a" }), makeTask({ id: "b" })];
    const result = applyRevisitFilter(tasks, false, new Set(["a"]));
    expect(result).toBe(tasks);
  });

  it("filters to only tasks marked for revisit when showRevisitOnly is true", () => {
    const tasks = [
      makeTask({ id: "a" }),
      makeTask({ id: "b" }),
      makeTask({ id: "c" }),
    ];
    const result = applyRevisitFilter(tasks, true, new Set(["a", "c"]));
    expect(result.map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("returns empty array when showRevisitOnly is true and no tasks are marked", () => {
    const tasks = [makeTask({ id: "a" }), makeTask({ id: "b" })];
    const result = applyRevisitFilter(tasks, true, new Set());
    expect(result).toEqual([]);
  });

  it("preserves pinned tasks that are also marked for revisit", () => {
    const tasks = [
      makeTask({ id: "a", isPinned: true }),
      makeTask({ id: "b", isPinned: true }),
      makeTask({ id: "c", isPinned: false }),
    ];
    const result = applyRevisitFilter(tasks, true, new Set(["a", "c"]));
    expect(result.map((t) => t.id)).toEqual(["a", "c"]);
    expect(result.find((t) => t.id === "a")?.isPinned).toBe(true);
  });

  it("returns empty array for empty input regardless of filter", () => {
    expect(applyRevisitFilter([], true, new Set(["a"]))).toEqual([]);
    expect(applyRevisitFilter([], false, new Set(["a"]))).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const tasks = [makeTask({ id: "a" }), makeTask({ id: "b" })];
    const snapshot = [...tasks];
    applyRevisitFilter(tasks, true, new Set(["a"]));
    expect(tasks).toEqual(snapshot);
  });
});
