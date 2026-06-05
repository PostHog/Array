import { beforeEach, describe, expect, it } from "vitest";

import { useInboxFilterStore } from "./inboxFilterStore";

const INITIAL_STATE = useInboxFilterStore.getState();

beforeEach(() => {
  useInboxFilterStore.setState(INITIAL_STATE, true);
});

describe("inboxFilterStore priority filter", () => {
  it("starts empty (no priority filter)", () => {
    expect(useInboxFilterStore.getState().priorityFilter).toEqual([]);
  });

  it("toggles a priority on and off", () => {
    const { togglePriority } = useInboxFilterStore.getState();

    togglePriority("P0");
    expect(useInboxFilterStore.getState().priorityFilter).toEqual(["P0"]);

    togglePriority("P0");
    expect(useInboxFilterStore.getState().priorityFilter).toEqual([]);
  });

  it("accumulates multiple priorities", () => {
    const { togglePriority } = useInboxFilterStore.getState();

    togglePriority("P0");
    togglePriority("P2");
    expect(useInboxFilterStore.getState().priorityFilter).toEqual(["P0", "P2"]);
  });

  it("dedupes when set directly", () => {
    useInboxFilterStore.getState().setPriorityFilter(["P1", "P1", "P3"]);
    expect(useInboxFilterStore.getState().priorityFilter).toEqual(["P1", "P3"]);
  });

  it("clears the priority filter on reset", () => {
    useInboxFilterStore.getState().setPriorityFilter(["P0", "P1"]);
    useInboxFilterStore.getState().resetFilters();
    expect(useInboxFilterStore.getState().priorityFilter).toEqual([]);
  });
});
