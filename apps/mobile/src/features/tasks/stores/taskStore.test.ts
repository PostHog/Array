import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import { filterAndSortTasks } from "./taskStore";

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: "task-1",
    task_number: 1,
    slug: "task-1",
    title: "A real task",
    description: "Do the thing",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    origin_product: "tasks",
    ...overrides,
  };
}

describe("filterAndSortTasks", () => {
  it("hides warm-sandbox placeholder tasks (no title and no description)", () => {
    const placeholder = makeTask({ id: "warm", title: "", description: "" });
    const real = makeTask({ id: "real" });

    const result = filterAndSortTasks(
      [placeholder, real],
      "updated",
      false,
      "",
    );

    expect(result.map((t) => t.id)).toEqual(["real"]);
  });

  it("keeps a real task that only has a description (title not landed yet)", () => {
    const pending = makeTask({
      id: "pending",
      title: "",
      description: "Fix login",
    });

    const result = filterAndSortTasks([pending], "updated", false, "");

    expect(result.map((t) => t.id)).toEqual(["pending"]);
  });

  it("keeps a task that only has a title", () => {
    const titled = makeTask({
      id: "titled",
      title: "Fix login",
      description: "",
    });

    const result = filterAndSortTasks([titled], "updated", false, "");

    expect(result.map((t) => t.id)).toEqual(["titled"]);
  });
});
