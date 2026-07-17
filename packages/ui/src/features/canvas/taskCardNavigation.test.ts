import { describe, expect, it } from "vitest";
import { shouldOpenTaskCardInline } from "./taskCardNavigation";

const PRIMARY_CLICK = {
  defaultPrevented: false,
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
};

describe("shouldOpenTaskCardInline", () => {
  it("opens an unmodified primary click in the thread dock", () => {
    expect(shouldOpenTaskCardInline(PRIMARY_CLICK)).toBe(true);
  });

  it.each([
    { defaultPrevented: true },
    { button: 1 },
    { metaKey: true },
    { ctrlKey: true },
    { shiftKey: true },
    { altKey: true },
  ])("leaves browser navigation intact for %o", (override) => {
    expect(shouldOpenTaskCardInline({ ...PRIMARY_CLICK, ...override })).toBe(
      false,
    );
  });
});
