import type { SignalReport, SignalReportPriority } from "@shared/types";
import { describe, expect, it } from "vitest";
import {
  buildPriorityFilterParam,
  buildSignalReportListOrdering,
  buildSuggestedReviewerFilterParam,
  filterReportsBySearch,
} from "./filterReports";

function makeReport(overrides: Partial<SignalReport> = {}): SignalReport {
  return {
    id: "1",
    title: "Test report",
    summary: "A summary of the report",
    status: "ready",
    total_weight: 50,
    signal_count: 10,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-02T00:00:00Z",
    artefact_count: 3,
    ...overrides,
  };
}

describe("filterReportsBySearch", () => {
  const reports = [
    makeReport({
      id: "1",
      title: "Login errors spike",
      summary: "Users cannot log in",
    }),
    makeReport({
      id: "2",
      title: "Checkout flow broken",
      summary: "Payment page crashes",
    }),
    makeReport({
      id: "3",
      title: "Slow dashboard load",
      summary: "Performance degradation",
    }),
  ];

  it("returns all reports when query is empty", () => {
    expect(filterReportsBySearch(reports, "")).toEqual(reports);
  });

  it("returns all reports when query is whitespace", () => {
    expect(filterReportsBySearch(reports, "   ")).toEqual(reports);
  });

  it("filters by title match", () => {
    const result = filterReportsBySearch(reports, "login");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });

  it("filters by summary match", () => {
    const result = filterReportsBySearch(reports, "payment");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("2");
  });

  it("is case insensitive", () => {
    const result = filterReportsBySearch(reports, "DASHBOARD");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("3");
  });

  it("handles null title", () => {
    const withNull = [
      makeReport({ id: "4", title: null, summary: "Some summary" }),
    ];
    const result = filterReportsBySearch(withNull, "some");
    expect(result).toHaveLength(1);
  });

  it("handles null summary", () => {
    const withNull = [makeReport({ id: "5", title: "A title", summary: null })];
    const result = filterReportsBySearch(withNull, "title");
    expect(result).toHaveLength(1);
  });

  it("handles both null title and summary", () => {
    const withNull = [makeReport({ id: "6", title: null, summary: null })];
    const result = filterReportsBySearch(withNull, "anything");
    expect(result).toHaveLength(0);
  });

  it("returns empty array when no matches", () => {
    const result = filterReportsBySearch(reports, "nonexistent");
    expect(result).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    expect(filterReportsBySearch([], "test")).toEqual([]);
  });
});

describe("buildSignalReportListOrdering", () => {
  it("puts status then suggested reviewer then descending field", () => {
    expect(buildSignalReportListOrdering("total_weight", "desc")).toBe(
      "status,-is_suggested_reviewer,-total_weight",
    );
  });

  it("puts status then suggested reviewer then ascending field", () => {
    expect(buildSignalReportListOrdering("created_at", "asc")).toBe(
      "status,-is_suggested_reviewer,created_at",
    );
  });

  it("works for signal_count", () => {
    expect(buildSignalReportListOrdering("signal_count", "desc")).toBe(
      "status,-is_suggested_reviewer,-signal_count",
    );
  });
});

describe("buildSuggestedReviewerFilterParam", () => {
  it("returns undefined for an empty array", () => {
    expect(buildSuggestedReviewerFilterParam([])).toBeUndefined();
  });

  it("trims reviewer ids and joins them with commas", () => {
    expect(
      buildSuggestedReviewerFilterParam([
        " reviewer-1 ",
        "reviewer-2",
        " reviewer-3",
      ]),
    ).toBe("reviewer-1,reviewer-2,reviewer-3");
  });

  it("deduplicates reviewer ids after trimming", () => {
    expect(
      buildSuggestedReviewerFilterParam([
        " reviewer-1 ",
        "reviewer-2",
        "reviewer-1",
        " reviewer-2 ",
      ]),
    ).toBe("reviewer-1,reviewer-2");
  });

  it("drops blank reviewer ids", () => {
    expect(
      buildSuggestedReviewerFilterParam([
        "reviewer-1",
        "   ",
        "reviewer-2",
        "",
      ]),
    ).toBe("reviewer-1,reviewer-2");
  });
});

describe("buildPriorityFilterParam", () => {
  it.each([
    { input: [] as SignalReportPriority[], expected: undefined },
    {
      input: ["P0", "P1", "P2"] as SignalReportPriority[],
      expected: "P0,P1,P2",
    },
    {
      input: ["P0", "P1", "P0", "P2", "P1"] as SignalReportPriority[],
      expected: "P0,P1,P2",
    },
  ])("buildPriorityFilterParam($input) → $expected", ({ input, expected }) => {
    expect(buildPriorityFilterParam(input)).toBe(expected);
  });
});
