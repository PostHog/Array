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

  it("setRevisit(true) marks a task and isRevisit returns true", () => {
    useRevisitStore.getState().setRevisit("task-1", true);
    expect(useRevisitStore.getState().isRevisit("task-1")).toBe(true);
    expect(useRevisitStore.getState().revisitTaskIds.has("task-1")).toBe(true);
  });

  it("setRevisit(false) removes a task", () => {
    useRevisitStore.getState().setRevisit("task-1", true);
    useRevisitStore.getState().setRevisit("task-1", false);
    expect(useRevisitStore.getState().isRevisit("task-1")).toBe(false);
  });

  it("setRevisit(true) is idempotent", () => {
    useRevisitStore.getState().setRevisit("task-1", true);
    useRevisitStore.getState().setRevisit("task-1", true);
    expect(useRevisitStore.getState().revisitTaskIds.size).toBe(1);
  });

  it("toggle flips state on and off", () => {
    useRevisitStore.getState().toggle("task-1");
    expect(useRevisitStore.getState().isRevisit("task-1")).toBe(true);
    useRevisitStore.getState().toggle("task-1");
    expect(useRevisitStore.getState().isRevisit("task-1")).toBe(false);
  });

  it("tracks multiple tasks independently", () => {
    useRevisitStore.getState().setRevisit("task-1", true);
    useRevisitStore.getState().setRevisit("task-2", true);
    useRevisitStore.getState().setRevisit("task-1", false);
    expect(useRevisitStore.getState().isRevisit("task-1")).toBe(false);
    expect(useRevisitStore.getState().isRevisit("task-2")).toBe(true);
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

  it("rehydrates marked tasks from localStorage as a Set", async () => {
    localStorage.setItem(
      "revisit-tasks-storage",
      JSON.stringify({
        state: { revisitTaskIds: ["task-1", "task-2"] },
        version: 0,
      }),
    );
    await useRevisitStore.persist.rehydrate();
    const state = useRevisitStore.getState();
    expect(state.revisitTaskIds).toBeInstanceOf(Set);
    expect(state.isRevisit("task-1")).toBe(true);
    expect(state.isRevisit("task-2")).toBe(true);
    expect(state.isRevisit("task-3")).toBe(false);
  });

  it("rehydrates with empty set when no persisted state exists", async () => {
    await useRevisitStore.persist.rehydrate();
    expect(useRevisitStore.getState().revisitTaskIds.size).toBe(0);
  });
});
