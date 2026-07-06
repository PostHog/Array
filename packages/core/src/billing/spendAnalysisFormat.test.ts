import { describe, expect, it } from "vitest";
import {
  formatTokens,
  type SpendAnalysisWindow,
  windowToDateFrom,
  windowToDays,
} from "./spendAnalysisFormat";

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

describe("windowToDateFrom", () => {
  it.each<[SpendAnalysisWindow, string]>([
    ["7d", "-7d"],
    ["30d", "-30d"],
    ["90d", "-90d"],
  ])("maps %s to %s", (window, expected) => {
    expect(windowToDateFrom(window)).toBe(expected);
  });
});

describe("windowToDays", () => {
  it.each<[SpendAnalysisWindow, number]>([
    ["7d", 7],
    ["30d", 30],
    ["90d", 90],
  ])("maps %s to %d", (window, expected) => {
    expect(windowToDays(window)).toBe(expected);
  });
});
