import { describe, expect, it } from "vitest";
import {
  applyTaskCreate,
  applyTaskUpdate,
  parseTaskCreateOutput,
  type TaskState,
  taskStateToPlanEntries,
} from "./task-state";

describe("parseTaskCreateOutput", () => {
  it("parses a JSON string with task.id", () => {
    const out = parseTaskCreateOutput('{"task":{"id":"t1"}}');
    expect(out?.task?.id).toBe("t1");
  });

  it("returns undefined for invalid JSON", () => {
    expect(parseTaskCreateOutput("not json")).toBeUndefined();
  });

  it("returns undefined when task.id is missing", () => {
    expect(parseTaskCreateOutput("{}")).toBeUndefined();
    expect(parseTaskCreateOutput('{"task":{}}')).toBeUndefined();
  });

  it("walks array of text blocks and returns the first parseable one", () => {
    const out = parseTaskCreateOutput([
      { type: "text", text: "garbage" },
      { type: "text", text: '{"task":{"id":"t2"}}' },
    ]);
    expect(out?.task?.id).toBe("t2");
  });

  it("ignores non-text blocks", () => {
    const out = parseTaskCreateOutput([
      { type: "image", text: '{"task":{"id":"t3"}}' },
    ]);
    expect(out).toBeUndefined();
  });

  it("returns undefined for null/undefined/non-string content", () => {
    expect(parseTaskCreateOutput(null)).toBeUndefined();
    expect(parseTaskCreateOutput(undefined)).toBeUndefined();
    expect(parseTaskCreateOutput(42)).toBeUndefined();
  });
});

describe("applyTaskCreate", () => {
  it("inserts a new entry keyed by output task id", () => {
    const state: TaskState = new Map();
    applyTaskCreate(
      state,
      {
        subject: "Fix bug",
        description: "details",
        activeForm: "Fixing bug",
      },
      { task: { id: "t1", subject: "Fix bug" } },
    );
    expect(state.get("t1")).toEqual({
      subject: "Fix bug",
      status: "pending",
      activeForm: "Fixing bug",
      description: "details",
    });
  });

  it("is a no-op when output has no task id", () => {
    const state: TaskState = new Map();
    applyTaskCreate(state, { subject: "x", description: "y" }, undefined);
    expect(state.size).toBe(0);
  });

  it("is a no-op when input is undefined", () => {
    const state: TaskState = new Map();
    applyTaskCreate(state, undefined, { task: { id: "t1", subject: "x" } });
    expect(state.size).toBe(0);
  });
});

describe("applyTaskUpdate", () => {
  it("removes the entry when status is deleted", () => {
    const state: TaskState = new Map([
      ["t1", { subject: "x", status: "pending" as const }],
    ]);
    applyTaskUpdate(state, { taskId: "t1", status: "deleted" });
    expect(state.has("t1")).toBe(false);
  });

  it("merges partial fields, preserving existing values", () => {
    const state: TaskState = new Map([
      [
        "t1",
        {
          subject: "Existing subject",
          status: "pending" as const,
          activeForm: "Doing",
          description: "Existing description",
        },
      ],
    ]);
    applyTaskUpdate(state, { taskId: "t1", status: "in_progress" });
    expect(state.get("t1")).toEqual({
      subject: "Existing subject",
      status: "in_progress",
      activeForm: "Doing",
      description: "Existing description",
    });
  });

  it("is a no-op when no existing entry and no subject in input", () => {
    const state: TaskState = new Map();
    applyTaskUpdate(state, { taskId: "t1", status: "completed" });
    expect(state.size).toBe(0);
  });

  it("creates a new entry when input provides a subject", () => {
    const state: TaskState = new Map();
    applyTaskUpdate(state, {
      taskId: "t1",
      subject: "Brand new",
      status: "in_progress",
    });
    expect(state.get("t1")?.subject).toBe("Brand new");
    expect(state.get("t1")?.status).toBe("in_progress");
  });

  it("is a no-op when input has no taskId", () => {
    const state: TaskState = new Map();
    applyTaskUpdate(state, undefined);
    expect(state.size).toBe(0);
  });
});

describe("taskStateToPlanEntries", () => {
  it("returns an empty array for an empty state", () => {
    expect(taskStateToPlanEntries(new Map())).toEqual([]);
  });

  it("preserves Map insertion order", () => {
    const state: TaskState = new Map();
    state.set("c", { subject: "third", status: "pending" });
    state.set("a", { subject: "first", status: "in_progress" });
    state.set("b", { subject: "second", status: "completed" });
    const entries = taskStateToPlanEntries(state);
    expect(entries.map((e) => e.content)).toEqual(["third", "first", "second"]);
    expect(entries.map((e) => e.status)).toEqual([
      "pending",
      "in_progress",
      "completed",
    ]);
  });

  it("hardcodes priority to medium", () => {
    const state: TaskState = new Map([
      ["t1", { subject: "x", status: "pending" }],
    ]);
    expect(taskStateToPlanEntries(state)[0].priority).toBe("medium");
  });
});
