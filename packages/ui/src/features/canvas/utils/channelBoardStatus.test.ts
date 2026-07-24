import { describe, expect, it } from "vitest";
import { channelBoardStatus } from "./channelBoardStatus";

describe("channelBoardStatus", () => {
  it.each([
    [{}, "working"],
    [{ status: "not_started" }, "working"],
    [{ status: "queued" }, "working"],
    [{ status: "in_progress" }, "working"],
    [{ status: "completed" }, "in_review"],
    [{ status: "failed" }, "done"],
    [{ status: "cancelled" }, "done"],
    [{ prState: "open" }, "in_review"],
    [{ prState: "draft" }, "in_review"],
    [{ prState: "merged" }, "done"],
    [{ prState: "closed" }, "done"],
    [{ needsPermission: true, status: "completed" }, "working"],
    [{ isGenerating: true, prState: "open" }, "working"],
    [{ homeSituation: "ci_failing" }, "ci_failing"],
  ] as const)("maps %o to %s", (overrides, expected) => {
    expect(
      channelBoardStatus({
        status: undefined,
        prState: null,
        needsPermission: false,
        isGenerating: false,
        ...overrides,
      }),
    ).toBe(expected);
  });
});
