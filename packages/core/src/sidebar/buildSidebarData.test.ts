import { describe, expect, it } from "vitest";
import {
  type DeriveTaskDataContext,
  deriveTaskData,
  limitTasksPerGroup,
  partitionAndSortTasks,
  type SidebarTask,
  sliceVisibleTasks,
} from "./buildSidebarData";
import type { TaskData, TaskGroup } from "./sidebarData.types";

function makeTask(id: string): TaskData {
  return {
    id,
    title: `Task ${id}`,
    createdAt: 0,
    lastActivityAt: 0,
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
    label: null,
  };
}

function makeGroup(id: string, taskCount: number): TaskGroup {
  return {
    id,
    name: id,
    tasks: Array.from({ length: taskCount }, (_, i) => makeTask(`${id}-${i}`)),
  };
}

describe("deriveTaskData", () => {
  const baseTask: SidebarTask = {
    id: "t1",
    title: "Task",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  };
  const baseCtx: DeriveTaskDataContext = {
    session: undefined,
    workspace: undefined,
    timestamp: undefined,
    pinnedIds: new Set<string>(),
    suspendedIds: new Set<string>(),
    slackTaskIds: new Set<string>(),
    slackThreadUrlByTaskId: new Map<string, string>(),
  };

  it("carries the label from the metadata record", () => {
    const data = deriveTaskData(baseTask, {
      ...baseCtx,
      timestamp: { lastViewedAt: null, lastActivityAt: null, label: "done" },
    });
    expect(data.label).toBe("done");
  });

  it("defaults the label to null when the task has no metadata record", () => {
    expect(deriveTaskData(baseTask, baseCtx).label).toBeNull();
  });
});

describe("partitionAndSortTasks with priority sort", () => {
  it("orders by label rank, unlabeled between active and deprioritized", () => {
    const tasks: TaskData[] = [
      { ...makeTask("done"), label: "done" },
      { ...makeTask("none") },
      { ...makeTask("high"), label: "high-priority" },
      { ...makeTask("deprio"), label: "deprioritized" },
      { ...makeTask("active"), label: "active" },
    ];
    const { sortedUnpinnedTasks } = partitionAndSortTasks(tasks, "priority");
    expect(sortedUnpinnedTasks.map((t) => t.id)).toEqual([
      "high",
      "active",
      "none",
      "deprio",
      "done",
    ]);
  });

  it("breaks rank ties by most recent activity", () => {
    const tasks: TaskData[] = [
      { ...makeTask("older"), label: "active", lastActivityAt: 1 },
      { ...makeTask("newer"), label: "active", lastActivityAt: 2 },
    ];
    const { sortedUnpinnedTasks } = partitionAndSortTasks(tasks, "priority");
    expect(sortedUnpinnedTasks.map((t) => t.id)).toEqual(["newer", "older"]);
  });

  it("still partitions pinned tasks out first", () => {
    const tasks: TaskData[] = [
      { ...makeTask("pinned"), label: "done", isPinned: true },
      { ...makeTask("high"), label: "high-priority" },
    ];
    const { pinnedTasks, sortedUnpinnedTasks } = partitionAndSortTasks(
      tasks,
      "priority",
    );
    expect(pinnedTasks.map((t) => t.id)).toEqual(["pinned"]);
    expect(sortedUnpinnedTasks.map((t) => t.id)).toEqual(["high"]);
  });
});

describe("sliceVisibleTasks", () => {
  it("caps the flat list to the visible count and reports hasMore", () => {
    const tasks = Array.from({ length: 30 }, (_, i) => makeTask(String(i)));
    const { flatTasks, hasMore } = sliceVisibleTasks(tasks, 25);
    expect(flatTasks).toHaveLength(25);
    expect(flatTasks[0]?.id).toBe("0");
    expect(hasMore).toBe(true);
  });

  it("returns every task and hasMore=false when under the cap", () => {
    const tasks = Array.from({ length: 10 }, (_, i) => makeTask(String(i)));
    const { flatTasks, hasMore } = sliceVisibleTasks(tasks, 25);
    expect(flatTasks).toHaveLength(10);
    expect(hasMore).toBe(false);
  });

  it("reports hasMore=false when the count exactly matches the cap", () => {
    const tasks = Array.from({ length: 25 }, (_, i) => makeTask(String(i)));
    expect(sliceVisibleTasks(tasks, 25).hasMore).toBe(false);
  });
});

describe("limitTasksPerGroup", () => {
  it("caps each group independently so quiet groups still show tasks", () => {
    const groups = [makeGroup("busy", 40), makeGroup("quiet", 3)];
    const { groups: limited, hasMore } = limitTasksPerGroup(groups, 25);
    expect(limited[0]?.tasks).toHaveLength(25);
    expect(limited[1]?.tasks).toHaveLength(3);
    expect(hasMore).toBe(true);
  });

  it("keeps empty groups (e.g. registered folders with no tasks)", () => {
    const groups = [makeGroup("empty", 0)];
    const { groups: limited, hasMore } = limitTasksPerGroup(groups, 25);
    expect(limited[0]?.tasks).toHaveLength(0);
    expect(hasMore).toBe(false);
  });

  it("does not clone groups that are under the cap", () => {
    const groups = [makeGroup("small", 5)];
    const { groups: limited, hasMore } = limitTasksPerGroup(groups, 25);
    expect(limited[0]).toBe(groups[0]);
    expect(hasMore).toBe(false);
  });
});
