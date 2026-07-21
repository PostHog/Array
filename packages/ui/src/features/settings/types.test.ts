import { describe, expect, it } from "vitest";
import { isSettingsCategory } from "./types";

describe("isSettingsCategory", () => {
  it.each(["agents", "skills", "mcp-servers"])(
    "accepts the %s configure category",
    (category) => {
      expect(isSettingsCategory(category)).toBe(true);
    },
  );

  it("rejects unknown categories", () => {
    expect(isSettingsCategory("configure")).toBe(false);
  });
});
