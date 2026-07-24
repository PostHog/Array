import { describe, expect, it } from "vitest";
import { channelBoardStatus } from "./channelBoardStatus";

describe("channelBoardStatus", () => {
  it.each([
    [{}, "todo"],
    [{ status: "not_started" }, "todo"],
    [{ status: "queued" }, "todo"],
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
