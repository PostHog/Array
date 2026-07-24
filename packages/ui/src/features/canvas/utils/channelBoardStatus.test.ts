import { describe, expect, it } from "vitest";
import { channelBoardStatus } from "./channelBoardStatus";

describe("channelBoardStatus", () => {
  it.each([
    [{}, "in_progress"],
    [{ status: "not_started" }, "in_progress"],
    [{ status: "queued" }, "in_progress"],
    [{ status: "in_progress" }, "in_progress"],
    [{ status: "completed" }, "ready"],
    [{ status: "failed" }, "closed"],
    [{ status: "cancelled" }, "closed"],
    [{ prState: "open" }, "ready"],
    [{ prState: "draft" }, "ready"],
    [{ prState: "merged" }, "closed"],
    [{ prState: "closed" }, "closed"],
    [{ needsPermission: true, status: "completed" }, "in_progress"],
    [{ isGenerating: true, prState: "open" }, "in_progress"],
    [{ status: "failed", prState: "open" }, "closed"],
    [{ needsFeedback: true, status: "completed" }, "needs_feedback"],
    [{ needsFeedback: true, status: "failed" }, "closed"],
    [{ needsFeedback: true, prState: "merged" }, "closed"],
  ] as const)("maps %o to %s", (overrides, expected) => {
    expect(
      channelBoardStatus({
        status: undefined,
        prState: null,
        needsPermission: false,
        isGenerating: false,
        needsFeedback: false,
        ...overrides,
      }),
    ).toBe(expected);
  });
});
