import { describe, expect, it } from "vitest";
import { formatTokens } from "./spendAnalysisFormat";

describe("formatTokens", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1_000, "1k"],
    [108_400, "108k"],
    [1_500_000, "1.5M"],
    [999_949_999, "999.9M"],
    [1_000_000_000, "1.0B"],
    [2_449_300_000, "2.4B"],
  ])("formats %d as %s", (input, expected) => {
    expect(formatTokens(input)).toBe(expected);
  });
});
