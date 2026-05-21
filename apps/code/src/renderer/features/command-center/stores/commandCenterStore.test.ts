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
        name: "caps fill at the number of cells",
        input: ["t1", "t2", "t3", "t4", "t5", "t6"],
        expectedCells: ["t1", "t2", "t3", "t4"],
      },
    ])(
      "$name, marks autofilled, leaves activeTaskId null",
      ({ input, expectedCells }) => {
        useCommandCenterStore.getState().autofillCells(input);
        expect(useCommandCenterStore.getState().cells).toEqual(expectedCells);
        expect(useCommandCenterStore.getState().activeTaskId).toBeNull();
        expect(useCommandCenterStore.getState().hasAutofilled).toBe(true);
      },
    );

    it("ignores empty task list and leaves hasAutofilled false so we can retry later", () => {
      useCommandCenterStore.getState().autofillCells([]);
      expect(useCommandCenterStore.getState().cells).toEqual([
        null,
        null,
        null,
        null,
      ]);
      expect(useCommandCenterStore.getState().hasAutofilled).toBe(false);
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
      expect(useCommandCenterStore.getState().hasAutofilled).toBe(false);
    });
  });

  describe("markAutofilled", () => {
    it("sets hasAutofilled to true without touching cells", () => {
      useCommandCenterStore.setState({ cells: ["x", null, null, null] });
      useCommandCenterStore.getState().markAutofilled();
      expect(useCommandCenterStore.getState().hasAutofilled).toBe(true);
      expect(useCommandCenterStore.getState().cells).toEqual([
        "x",
        null,
        null,
        null,
      ]);
    });
  });
});
