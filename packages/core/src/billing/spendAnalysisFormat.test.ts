import { describe, expect, it } from "vitest";
import {
  fillSpendDays,
  fillSpendHours,
  formatTokens,
  type SpendAnalysisWindow,
  windowToDateFrom,
  windowToDays,
} from "./spendAnalysisFormat";
import type { SpendAnalysisHourRow } from "./spendAnalysisTypes";

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
    ["7d", "-6dStart"],
    ["30d", "-29dStart"],
    ["90d", "-89dStart"],
  ])("maps %s to the day-aligned %s", (window, expected) => {
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

describe("fillSpendDays", () => {
  it("zero-fills days without rows across the window", () => {
    const filled = fillSpendDays(
      [
        { day: "2026-07-01", event_count: 3, cost_usd: 1.5 },
        { day: "2026-07-03", event_count: 1, cost_usd: 0.25 },
      ],
      "2026-07-01T00:00:00Z",
      "2026-07-04T12:00:00Z",
    );
    expect(filled).toEqual([
      { day: "2026-07-01", event_count: 3, cost_usd: 1.5 },
      { day: "2026-07-02", event_count: 0, cost_usd: 0 },
      { day: "2026-07-03", event_count: 1, cost_usd: 0.25 },
      { day: "2026-07-04", event_count: 0, cost_usd: 0 },
    ]);
  });

  it("returns one zeroed row per day when there are no rows", () => {
    const filled = fillSpendDays(
      [],
      "2026-07-01T06:00:00Z",
      "2026-07-03T00:00:00Z",
    );
    expect(filled.map((d) => d.day)).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
    ]);
    expect(filled.every((d) => d.cost_usd === 0 && d.event_count === 0)).toBe(
      true,
    );
  });

  it("caps runaway windows instead of looping unbounded", () => {
    const filled = fillSpendDays(
      [],
      "2020-01-01T00:00:00Z",
      "2026-01-01T00:00:00Z",
    );
    expect(filled.length).toBe(100);
  });
});

describe("fillSpendHours", () => {
  const row = (
    hour: string,
    cost: number,
    cacheCreation = 0,
  ): SpendAnalysisHourRow => ({
    hour,
    event_count: 1,
    cost_usd: cost,
    input_cost_usd: 0.1,
    output_cost_usd: 0.2,
    cache_read_cost_usd: 0.3,
    cache_creation_cost_usd: cacheCreation,
    input_tokens: 100,
    output_tokens: 50,
    cache_read_input_tokens: 1000,
    cache_creation_input_tokens: 500,
  });

  it("zero-fills missing hours and aligns the window to hour starts", () => {
    const filled = fillSpendHours(
      [row("2026-07-10T09:00:00Z", 1.0), row("2026-07-10T11:00:00Z", 3.0, 2.5)],
      "2026-07-10T08:30:00Z",
      "2026-07-10T11:10:00Z",
    );
    expect(filled.map((h) => [h.hour, h.cost_usd])).toEqual([
      ["2026-07-10T08:00:00.000Z", 0],
      ["2026-07-10T09:00:00.000Z", 1.0],
      ["2026-07-10T10:00:00.000Z", 0],
      ["2026-07-10T11:00:00.000Z", 3.0],
    ]);
    expect(filled[3]?.cache_creation_cost_usd).toBe(2.5);
    expect(filled[2]?.event_count).toBe(0);
  });

  it("buckets rows with sub-hour timestamps into their hour", () => {
    const filled = fillSpendHours(
      [row("2026-07-10T09:30:15.500Z", 1.0)],
      "2026-07-10T09:00:00Z",
      "2026-07-10T10:00:00Z",
    );
    expect(filled.map((h) => [h.hour, h.cost_usd])).toEqual([
      ["2026-07-10T09:00:00.000Z", 1.0],
      ["2026-07-10T10:00:00.000Z", 0],
    ]);
  });

  it("caps runaway windows instead of looping unbounded", () => {
    const filled = fillSpendHours(
      [],
      "2020-01-01T00:00:00Z",
      "2026-01-01T00:00:00Z",
    );
    expect(filled.length).toBe(200);
  });
});
