import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@utils/electronStorage", () => ({
  electronStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
}));

import {
  COMMAND_CENTER_INITIAL_STATE,
  useCommandCenterStore,
} from "./commandCenterStore";

function resetStore() {
  useCommandCenterStore.setState(COMMAND_CENTER_INITIAL_STATE);
}

describe("commandCenterStore", () => {
  beforeEach(resetStore);

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

    it("fills only the empty slots when some cells are already populated", () => {
      useCommandCenterStore.setState({ cells: [null, "existing", null, null] });
      useCommandCenterStore.getState().autofillCells(["t1", "t2", "t3"]);
      expect(useCommandCenterStore.getState().cells).toEqual([
        "t1",
        "existing",
        "t2",
        "t3",
      ]);
    });

    it("does nothing when every cell is already populated", () => {
      useCommandCenterStore.setState({ cells: ["a", "b", "c", "d"] });
      useCommandCenterStore.getState().autofillCells(["t1", "t2"]);
      expect(useCommandCenterStore.getState().cells).toEqual([
        "a",
        "b",
        "c",
        "d",
      ]);
    });

    it("stops filling when task list runs out before empty slots do", () => {
      useCommandCenterStore.setState({ cells: [null, null, "x", null] });
      useCommandCenterStore.getState().autofillCells(["t1"]);
      expect(useCommandCenterStore.getState().cells).toEqual([
        "t1",
        null,
        "x",
        null,
      ]);
    });
  });
});
