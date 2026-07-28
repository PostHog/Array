import { describe, expect, it } from "vitest";
import { asLoopBackTarget } from "./loopBackTarget";

describe("asLoopBackTarget", () => {
  it.each([
    [undefined],
    [null],
    [{}],
    [{ channelId: "" }],
    [{ channelId: 42 }],
  ])("rejects an invalid history target", (target) => {
    expect(asLoopBackTarget(target)).toBeNull();
  });

  it("accepts a channel origin", () => {
    expect(asLoopBackTarget({ channelId: "channel-1" })).toEqual({
      channelId: "channel-1",
    });
  });
});
