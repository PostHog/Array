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
    it("fills empty cells from index 0", () => {
      useCommandCenterStore.getState().autofillCells(["t1", "t2"]);
      expect(useCommandCenterStore.getState().cells).toEqual([
        "t1",
        "t2",
        null,
        null,
      ]);
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

    it("ignores empty task list", () => {
      useCommandCenterStore.getState().autofillCells([]);
      expect(useCommandCenterStore.getState().cells).toEqual([
        null,
        null,
        null,
        null,
      ]);
    });

    it("caps fill at the number of cells", () => {
      useCommandCenterStore
        .getState()
        .autofillCells(["t1", "t2", "t3", "t4", "t5", "t6"]);
      expect(useCommandCenterStore.getState().cells).toEqual([
        "t1",
        "t2",
        "t3",
        "t4",
      ]);
    });

    it("does not set activeTaskId", () => {
      useCommandCenterStore.getState().autofillCells(["t1"]);
      expect(useCommandCenterStore.getState().activeTaskId).toBeNull();
    });
  });
});
