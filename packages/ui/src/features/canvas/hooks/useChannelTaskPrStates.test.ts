import { describe, expect, it } from "vitest";
import { prDetailsToState } from "./useChannelTaskPrStates";

describe("prDetailsToState", () => {
  it.each([
    [undefined, null],
    [{ state: "open", merged: false, draft: false }, "open"],
    [{ state: "open", merged: false, draft: true }, "draft"],
    [{ state: "closed", merged: false, draft: false }, "closed"],
    [{ state: "closed", merged: true, draft: false }, "merged"],
  ] as const)("maps %o to %s", (details, expected) => {
    expect(prDetailsToState(details)).toBe(expected);
  });
});
