import { beforeEach, describe, expect, it } from "vitest";
import { useRevisitStore } from "./revisitStore";

describe("revisitStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useRevisitStore.setState({ revisitTaskIds: new Set<string>() });
  });

  it("starts with an empty set", () => {
    expect(useRevisitStore.getState().revisitTaskIds.size).toBe(0);
    expect(useRevisitStore.getState().isRevisit("task-1")).toBe(false);
  });

  describe("setRevisit", () => {
    it.each<{
      name: string;
      ops: Array<["setRevisit", string, boolean]>;
      expected: { id: string; revisit: boolean }[];
      expectedSize: number;
    }>([
      {
        name: "setRevisit(true) marks a task",
        ops: [["setRevisit", "task-1", true]],
        expected: [{ id: "task-1", revisit: true }],
        expectedSize: 1,
      },
      {
        name: "setRevisit(false) on unmarked task is a no-op",
        ops: [["setRevisit", "task-1", false]],
        expected: [{ id: "task-1", revisit: false }],
        expectedSize: 0,
      },
      {
        name: "setRevisit(false) removes a previously marked task",
        ops: [
          ["setRevisit", "task-1", true],
          ["setRevisit", "task-1", false],
        ],
        expected: [{ id: "task-1", revisit: false }],
        expectedSize: 0,
      },
      {
        name: "setRevisit(true) is idempotent",
        ops: [
          ["setRevisit", "task-1", true],
          ["setRevisit", "task-1", true],
        ],
        expected: [{ id: "task-1", revisit: true }],
        expectedSize: 1,
      },
      {
        name: "tracks multiple tasks independently",
        ops: [
          ["setRevisit", "task-1", true],
          ["setRevisit", "task-2", true],
          ["setRevisit", "task-1", false],
        ],
        expected: [
          { id: "task-1", revisit: false },
          { id: "task-2", revisit: true },
        ],
        expectedSize: 1,
      },
    ])("$name", ({ ops, expected, expectedSize }) => {
      for (const [, taskId, on] of ops) {
        useRevisitStore.getState().setRevisit(taskId, on);
      }
      const state = useRevisitStore.getState();
      expect(state.revisitTaskIds.size).toBe(expectedSize);
      for (const { id, revisit } of expected) {
        expect(state.isRevisit(id)).toBe(revisit);
      }
    });
  });

  it("toggle flips state on and off", () => {
    useRevisitStore.getState().toggle("task-1");
    expect(useRevisitStore.getState().isRevisit("task-1")).toBe(true);
    useRevisitStore.getState().toggle("task-1");
    expect(useRevisitStore.getState().isRevisit("task-1")).toBe(false);
  });

  it("persists marked tasks to localStorage as an array", () => {
    useRevisitStore.getState().setRevisit("task-1", true);
    useRevisitStore.getState().setRevisit("task-2", true);
    const raw = localStorage.getItem("revisit-tasks-storage");
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw as string);
    expect(persisted.state.revisitTaskIds).toEqual(
      expect.arrayContaining(["task-1", "task-2"]),
    );
    expect(persisted.state.revisitTaskIds).toHaveLength(2);
  });

  describe("rehydrate", () => {
    it.each<{
      name: string;
      seed: string[] | null;
      expectedSize: number;
      checks: Array<[string, boolean]>;
    }>([
      {
        name: "from persisted ids restores a Set",
        seed: ["task-1", "task-2"],
        expectedSize: 2,
        checks: [
          ["task-1", true],
          ["task-2", true],
          ["task-3", false],
        ],
      },
      {
        name: "with no persisted state yields an empty Set",
        seed: null,
        expectedSize: 0,
        checks: [["task-1", false]],
      },
    ])("$name", async ({ seed, expectedSize, checks }) => {
      if (seed) {
        localStorage.setItem(
          "revisit-tasks-storage",
          JSON.stringify({
            state: { revisitTaskIds: seed },
            version: 0,
          }),
        );
      }
      await useRevisitStore.persist.rehydrate();
      const state = useRevisitStore.getState();
      expect(state.revisitTaskIds).toBeInstanceOf(Set);
      expect(state.revisitTaskIds.size).toBe(expectedSize);
      for (const [id, revisit] of checks) {
        expect(state.isRevisit(id)).toBe(revisit);
      }
    });
  });
});
