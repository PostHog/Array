import type { SignalReport } from "@posthog/shared/types";
import { describe, expect, it } from "vitest";
import { buildInboxViewedProperties } from "./engagement";

function fakeReport(overrides: Partial<SignalReport> = {}): SignalReport {
  return {
    id: "r1",
    title: "Test report",
    summary: "Summary",
    status: "ready",
    total_weight: 1,
    signal_count: 1,
    created_at: "2026-06-05T00:00:00Z",
    updated_at: "2026-06-05T00:00:00Z",
    artefact_count: 0,
    priority: null,
    actionability: null,
    is_suggested_reviewer: false,
    source_products: [],
    implementation_pr_url: null,
    ...overrides,
  };
}

const NO_FILTERS = {
  sourceProductFilter: [],
  priorityFilter: [],
  searchQuery: "",
  isDefaultScope: true,
};

describe("buildInboxViewedProperties", () => {
  it("counts visible reports, tab badges, and total", () => {
    const props = buildInboxViewedProperties({
      visibleReports: [fakeReport({ id: "a" }), fakeReport({ id: "b" })],
      totalCount: 65,
      tabCounts: { pulls: 38, reports: 62, runs: 4 },
      filters: NO_FILTERS,
    });

    expect(props.report_count).toBe(2);
    expect(props.total_count).toBe(65);
    expect(props.ready_count).toBe(2);
    expect(props.pulls_count).toBe(38);
    expect(props.reports_count).toBe(62);
    expect(props.runs_count).toBe(4);
    expect(props.is_empty).toBe(false);
    expect(props.status_filter_count).toBe(0);
  });

  it("breaks visible reports down by priority and actionability", () => {
    const props = buildInboxViewedProperties({
      visibleReports: [
        fakeReport({ priority: "P0", actionability: "immediately_actionable" }),
        fakeReport({ priority: "P0", actionability: "requires_human_input" }),
        fakeReport({ priority: "P2", actionability: "not_actionable" }),
        fakeReport({ priority: null, actionability: null }),
      ],
      totalCount: 4,
      tabCounts: { pulls: 0, reports: 4, runs: 0 },
      filters: NO_FILTERS,
    });

    expect(props.priority_p0_count).toBe(2);
    expect(props.priority_p2_count).toBe(1);
    expect(props.priority_unknown_count).toBe(1);
    expect(props.actionability_immediately_actionable_count).toBe(1);
    expect(props.actionability_requires_human_input_count).toBe(1);
    expect(props.actionability_not_actionable_count).toBe(1);
    expect(props.actionability_unknown_count).toBe(1);
  });

  it("only counts ready reports toward ready_count", () => {
    const props = buildInboxViewedProperties({
      visibleReports: [
        fakeReport({ status: "ready" }),
        fakeReport({ status: "in_progress" }),
      ],
      totalCount: 2,
      tabCounts: { pulls: 0, reports: 1, runs: 1 },
      filters: NO_FILTERS,
    });

    expect(props.ready_count).toBe(1);
  });

  it("reports is_empty when the total count is zero", () => {
    const props = buildInboxViewedProperties({
      visibleReports: [],
      totalCount: 0,
      tabCounts: { pulls: 0, reports: 0, runs: 0 },
      filters: NO_FILTERS,
    });

    expect(props.is_empty).toBe(true);
    expect(props.has_active_filters).toBe(false);
  });

  it.each([
    ["source product", { sourceProductFilter: ["error_tracking"] }],
    ["priority", { priorityFilter: ["P0"] }],
    ["search", { searchQuery: "  crash  " }],
    ["non-default scope", { isDefaultScope: false }],
  ])("flags has_active_filters for a %s filter", (_label, partial) => {
    const props = buildInboxViewedProperties({
      visibleReports: [fakeReport()],
      totalCount: 1,
      tabCounts: { pulls: 0, reports: 1, runs: 0 },
      filters: { ...NO_FILTERS, ...partial },
    });

    expect(props.has_active_filters).toBe(true);
  });

  it("does not flag has_active_filters for a whitespace-only search", () => {
    const props = buildInboxViewedProperties({
      visibleReports: [fakeReport()],
      totalCount: 1,
      tabCounts: { pulls: 0, reports: 1, runs: 0 },
      filters: { ...NO_FILTERS, searchQuery: "   " },
    });

    expect(props.has_active_filters).toBe(false);
  });
});
