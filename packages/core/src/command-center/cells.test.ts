import type { Task } from "@posthog/shared/domain-types";
import { describe, expect, it } from "vitest";
import { buildCommandCenterCells } from "./cells";
import { BRAINROT_CELL } from "./grid";

const EMPTY_INPUT = {
  taskById: new Map<string, Task>(),
  sessionByTaskId: new Map(),
  workspaces: undefined,
};

describe("buildCommandCenterCells", () => {
  it("marks a brainrot sentinel cell as isBrainrot with no task", () => {
    const [cell] = buildCommandCenterCells([BRAINROT_CELL], EMPTY_INPUT);
    expect(cell).toMatchObject({
      cellIndex: 0,
      isBrainrot: true,
      taskId: null,
      task: undefined,
      status: "idle",
    });
  });

  it("treats an empty cell as a non-brainrot empty slot", () => {
    const [cell] = buildCommandCenterCells([null], EMPTY_INPUT);
    expect(cell).toMatchObject({ isBrainrot: false, taskId: null });
  });

  it("treats an unknown task id as a non-brainrot cell", () => {
    const [cell] = buildCommandCenterCells(["missing"], EMPTY_INPUT);
    expect(cell).toMatchObject({ isBrainrot: false, taskId: "missing" });
  });
});
