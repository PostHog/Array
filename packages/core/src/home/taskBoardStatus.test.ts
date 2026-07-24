import { describe, expect, it } from "vitest";
import { taskBoardStatus, taskBoardStatusFromSources } from "./taskBoardStatus";

describe("taskBoardStatus", () => {
  it.each([
    [{}, "working"],
    [{ runStatus: "in_progress" }, "working"],
    [{ runStatus: "completed" }, "working"],
    [{ prState: "draft", ciStatus: "passing" }, "working"],
    [{ prState: "open", ciStatus: "failing" }, "working"],
    [{ prState: "open", ciStatus: "pending" }, "working"],
    [{ prState: "open", ciStatus: null }, "working"],
    [{ prState: "open", ciStatus: "passing" }, "in_review"],
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
        ciStatus: "passing",
      } as never,
    }),
  ).toBe("done");
});
