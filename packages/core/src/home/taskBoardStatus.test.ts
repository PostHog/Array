import { describe, expect, it } from "vitest";
import { taskBoardStatus, taskBoardStatusFromSources } from "./taskBoardStatus";

describe("taskBoardStatus", () => {
  it.each([
    [{}, "working"],
    [{ runStatus: "in_progress" }, "working"],
    [{ runStatus: "completed" }, "done"],
    [{ runStatus: "completed", prState: "draft" }, "working"],
    [{ prState: "draft" }, "working"],
    [{ prState: "open" }, "in_review"],
    [{ prState: "merged", runStatus: "failed" }, "done"],
    [{ prState: "closed" }, "cancelled"],
    [{ runStatus: "failed" }, "cancelled"],
    [{ runStatus: "cancelled" }, "cancelled"],
  ] as const)("maps %o to %s", (input, expected) => {
    expect(taskBoardStatus(input)).toBe(expected);
  });
});

it("prefers a directly resolved merged PR over a stale open Home snapshot", () => {
  expect(
    taskBoardStatusFromSources({
      resolvedPrState: "merged",
      prSnapshot: {
        state: "open",
        ciStatus: "failing",
      } as never,
    }),
  ).toBe("done");
});
