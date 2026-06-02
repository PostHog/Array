import { describe, expect, it } from "vitest";
import { formatCodexModelName } from "./models";

describe("formatCodexModelName", () => {
  it("uses raw lowercase model ids", () => {
    expect(formatCodexModelName("GPT-5.5")).toBe("gpt-5.5");
  });
});
