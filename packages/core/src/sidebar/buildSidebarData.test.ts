import { describe, expect, it } from "vitest";
import {
  type FilterVisibleOptions,
  filterVisibleTasks,
  type SidebarTask,
} from "./buildSidebarData";

function task(id: string): SidebarTask {
  return {
    id,
    title: id,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

const BASE: FilterVisibleOptions = {
  archivedIds: new Set(),
  workspaceIds: new Set(),
  provisioningIds: new Set(),
  showAllUsers: false,
  showSystemStarted: false,
};

describe("filterVisibleTasks", () => {
  it("hides tasks with no local workspace/provisioning in the default view", () => {
    const result = filterVisibleTasks([task("a")], BASE);
    expect(result).toEqual([]);
  });

  it.each([
    { name: "workspace", key: "workspaceIds" as const },
    { name: "provisioning", key: "provisioningIds" as const },
  ])("shows a task present locally via $name", ({ key }) => {
    const result = filterVisibleTasks([task("a")], {
      ...BASE,
      [key]: new Set(["a"]),
    });
    expect(result.map((t) => t.id)).toEqual(["a"]);
  });

  it("always hides archived tasks, even when otherwise visible", () => {
    const result = filterVisibleTasks([task("a")], {
      ...BASE,
      workspaceIds: new Set(["a"]),
      archivedIds: new Set(["a"]),
    });
    expect(result).toEqual([]);
  });

  it.each([
    { name: "showAllUsers", flag: "showAllUsers" as const },
    { name: "showSystemStarted", flag: "showSystemStarted" as const },
  ])("bypasses the local-scope gate when $name is set", ({ flag }) => {
    const result = filterVisibleTasks([task("a"), task("b")], {
      ...BASE,
      [flag]: true,
    });
    expect(result.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("still hides archived tasks when the local-scope gate is bypassed", () => {
    const result = filterVisibleTasks([task("a"), task("b")], {
      ...BASE,
      showSystemStarted: true,
      archivedIds: new Set(["a"]),
    });
    expect(result.map((t) => t.id)).toEqual(["b"]);
  });
});
