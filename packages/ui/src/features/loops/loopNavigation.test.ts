import { describe, expect, it } from "vitest";
import { validateLoopRouteSearch } from "./loopNavigation";

describe("validateLoopRouteSearch", () => {
  it("accepts a non-empty channel return target", () => {
    expect(validateLoopRouteSearch({ channelId: "channel-123" })).toEqual({
      channelId: "channel-123",
    });
  });

  it.each([undefined, null, "", 123])(
    "rejects an invalid channel return target: %s",
    (channelId) => {
      expect(validateLoopRouteSearch({ channelId })).toEqual({
        channelId: undefined,
      });
    },
  );
});
