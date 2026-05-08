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
  it.each<{
    name: string;
    tasks: TaskData[];
    showRevisitOnly: boolean;
    revisitIds: string[];
    expectedIds: string[];
    /** When true, the filter is expected to short-circuit and return the input by reference. */
    expectSameRef?: boolean;
  }>([
    {
      name: "returns input unchanged when showRevisitOnly is false",
      tasks: [makeTask({ id: "a" }), makeTask({ id: "b" })],
      showRevisitOnly: false,
      revisitIds: ["a"],
      expectedIds: ["a", "b"],
      expectSameRef: true,
    },
    {
      name: "filters to only tasks marked for revisit when showRevisitOnly is true",
      tasks: [
        makeTask({ id: "a" }),
        makeTask({ id: "b" }),
        makeTask({ id: "c" }),
      ],
      showRevisitOnly: true,
      revisitIds: ["a", "c"],
      expectedIds: ["a", "c"],
    },
    {
      name: "returns empty array when showRevisitOnly is true and no tasks are marked",
      tasks: [makeTask({ id: "a" }), makeTask({ id: "b" })],
      showRevisitOnly: true,
      revisitIds: [],
      expectedIds: [],
    },
    {
      name: "preserves pinned tasks that are also marked for revisit",
      tasks: [
        makeTask({ id: "a", isPinned: true }),
        makeTask({ id: "b", isPinned: true }),
        makeTask({ id: "c", isPinned: false }),
      ],
      showRevisitOnly: true,
      revisitIds: ["a", "c"],
      expectedIds: ["a", "c"],
    },
    {
      name: "empty input with filter on returns empty",
      tasks: [],
      showRevisitOnly: true,
      revisitIds: ["a"],
      expectedIds: [],
    },
    {
      name: "empty input with filter off returns empty",
      tasks: [],
      showRevisitOnly: false,
      revisitIds: ["a"],
      expectedIds: [],
      expectSameRef: true,
    },
  ])(
    "$name",
    ({ tasks, showRevisitOnly, revisitIds, expectedIds, expectSameRef }) => {
      const snapshot = [...tasks];
      const result = applyRevisitFilter(
        tasks,
        showRevisitOnly,
        new Set(revisitIds),
      );
      expect(result.map((t) => t.id)).toEqual(expectedIds);
      if (expectSameRef) expect(result).toBe(tasks);
      // Filter must never mutate the input array.
      expect(tasks).toEqual(snapshot);
    },
  );
});
