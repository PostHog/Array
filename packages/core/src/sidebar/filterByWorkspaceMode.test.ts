import { describe, expect, it } from "vitest";
import {
  ALL_WORKSPACE_MODES,
  filterByWorkspaceMode,
} from "./buildSidebarData";
import type { TaskData } from "./sidebarData.types";

const task = (overrides: Partial<TaskData>): TaskData => ({
  id: "t",
  title: "t",
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
  ...overrides,
});

describe("filterByWorkspaceMode", () => {
  const worktree = task({ id: "w", workspaceMode: "worktree" });
  const local = task({ id: "l", workspaceMode: "local" });
  const cloud = task({ id: "c", workspaceMode: "cloud" });
  const unknown = task({ id: "u", workspaceMode: undefined });
  const tasks = [worktree, local, cloud, unknown];

  it("returns all tasks when every mode is enabled", () => {
    expect(filterByWorkspaceMode(tasks, ALL_WORKSPACE_MODES)).toEqual(tasks);
  });

  it("keeps only tasks whose mode is enabled, plus unknown-mode tasks", () => {
    expect(filterByWorkspaceMode(tasks, ["local"])).toEqual([local, unknown]);
  });

  it("keeps multiple enabled modes", () => {
    expect(filterByWorkspaceMode(tasks, ["worktree", "cloud"])).toEqual([
      worktree,
      cloud,
      unknown,
    ]);
  });

  it("keeps only unknown-mode tasks when nothing is enabled", () => {
    expect(filterByWorkspaceMode(tasks, [])).toEqual([unknown]);
  });
});
