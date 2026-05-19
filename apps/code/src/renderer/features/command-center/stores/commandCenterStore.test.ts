import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@utils/electronStorage", () => ({
  electronStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
}));

import { useCommandCenterStore } from "./commandCenterStore";

describe("commandCenterStore", () => {
  beforeEach(() => {
    useCommandCenterStore.setState({
      layout: "2x2",
      cells: [null, null, null, null],
      activeTaskId: null,
      activeCellIndex: null,
      zoom: 1,
      creatingCells: [],
    });
  });

  describe("autofillCells", () => {
    it.each([
      {
        name: "fills empty cells from index 0",
        input: ["t1", "t2"],
        expectedCells: ["t1", "t2", null, null],
      },
      {
        name: "ignores empty task list",
        input: [],
        expectedCells: [null, null, null, null],
      },
      {
        name: "caps fill at the number of cells",
        input: ["t1", "t2", "t3", "t4", "t5", "t6"],
        expectedCells: ["t1", "t2", "t3", "t4"],
      },
    ])("$name and leaves activeTaskId null", ({ input, expectedCells }) => {
      useCommandCenterStore.getState().autofillCells(input);
      expect(useCommandCenterStore.getState().cells).toEqual(expectedCells);
      expect(useCommandCenterStore.getState().activeTaskId).toBeNull();
    });

    it("does nothing when any cell is already populated", () => {
      useCommandCenterStore.setState({ cells: [null, "existing", null, null] });
      useCommandCenterStore.getState().autofillCells(["t1", "t2"]);
      expect(useCommandCenterStore.getState().cells).toEqual([
        null,
        "existing",
        null,
        null,
      ]);
    });
  });
});
