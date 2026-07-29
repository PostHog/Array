import type { ReportChart } from "@posthog/shared";
import { describe, expect, it } from "vitest";
import {
  planReportChart,
  reportChartQueryHash,
  resolveReportChartSize,
  shapeNumberResponse,
  shapeTableResponse,
  shapeTrendsResponse,
} from "./reportCharts";

function chart(query: Record<string, unknown>, extra?: Partial<ReportChart>) {
  return {
    chart_id: "c",
    title: "Chart",
    query,
    ...extra,
  } satisfies ReportChart;
}

function trends(
  source: Record<string, unknown> = { kind: "TrendsQuery" },
): Record<string, unknown> {
  return { kind: "InsightVizNode", source };
}

describe("planReportChart", () => {
  it.each([
    { display: undefined, expected: { kind: "timeseries", variant: "line" } },
    {
      display: "ActionsLineGraph",
      expected: { kind: "timeseries", variant: "line" },
    },
    {
      display: "ActionsAreaGraph",
      expected: { kind: "timeseries", variant: "line" },
    },
    { display: "ActionsBar", expected: { kind: "timeseries", variant: "bar" } },
    {
      display: "ActionsStackedBar",
      expected: { kind: "timeseries", variant: "bar" },
    },
    { display: "BoldNumber", expected: { kind: "number" } },
  ])("plans a $display trend", ({ display, expected }) => {
    const query = trends({
      kind: "TrendsQuery",
      ...(display ? { trendsFilter: { display } } : {}),
    });

    expect(planReportChart(chart(query))).toEqual(expected);
  });

  it("plans a SQL query as a table", () => {
    expect(planReportChart(chart({ kind: "DataVisualizationNode" }))).toEqual({
      kind: "table",
    });
  });

  it.each([
    { query: trends({ kind: "FunnelsQuery" }), reason: "Funnel charts" },
    { query: trends({ kind: "RetentionQuery" }), reason: "Retention charts" },
    { query: { kind: "SavedInsightNode" }, reason: "Saved insights" },
    {
      query: trends({
        kind: "TrendsQuery",
        trendsFilter: { display: "WorldMap" },
      }),
      reason: "isn't supported",
    },
    { query: trends({ kind: "SomeFutureQuery" }), reason: "isn't supported" },
  ])("marks $reason unsupported", ({ query, reason }) => {
    const plan = planReportChart(chart(query));

    expect(plan.kind).toBe("unsupported");
    expect(plan.kind === "unsupported" && plan.reason).toContain(reason);
  });
});

describe("resolveReportChartSize", () => {
  it("honours the size the report chose", () => {
    const plan = { kind: "number" } as const;

    expect(
      resolveReportChartSize(chart(trends(), { size: "large" }), plan),
    ).toBe("large");
  });

  it.each([
    { plan: { kind: "number" } as const, expected: "small" },
    { plan: { kind: "table" } as const, expected: "medium" },
    {
      plan: { kind: "timeseries", variant: "line" } as const,
      expected: "medium",
    },
  ])("defaults a $plan.kind chart to $expected", ({ plan, expected }) => {
    expect(resolveReportChartSize(chart(trends()), plan)).toBe(expected);
  });
});

describe("shapeTrendsResponse", () => {
  it("maps results into parallel series and labels", () => {
    const response = {
      results: [
        { label: "$pageview", data: [1, 2, 3], days: ["d1", "d2", "d3"] },
        { label: "signup", data: [4, 5, 6], days: ["d1", "d2", "d3"] },
      ],
    };

    expect(shapeTrendsResponse(response)).toEqual({
      labels: ["d1", "d2", "d3"],
      series: [
        { key: "0-$pageview", label: "$pageview", data: [1, 2, 3] },
        { key: "1-signup", label: "signup", data: [4, 5, 6] },
      ],
    });
  });

  it("falls back to `labels` when the trend has no days", () => {
    const response = { results: [{ data: [1, 2], labels: ["a", "b"] }] };

    expect(shapeTrendsResponse(response)?.labels).toEqual(["a", "b"]);
  });

  it("names an unlabelled series by position", () => {
    const response = { results: [{ data: [1], days: ["d1"] }] };

    expect(shapeTrendsResponse(response)?.series[0].label).toBe("Series 1");
  });

  it("trims every series to the shortest run so the x-axis stays aligned", () => {
    const response = {
      results: [
        { label: "a", data: [1, 2, 3], days: ["d1", "d2", "d3"] },
        { label: "b", data: [4], days: ["d1", "d2", "d3"] },
      ],
    };

    expect(shapeTrendsResponse(response)).toEqual({
      labels: ["d1"],
      series: [
        { key: "0-a", label: "a", data: [1] },
        { key: "1-b", label: "b", data: [4] },
      ],
    });
  });

  it("skips an empty series instead of discarding the whole chart", () => {
    const response = {
      results: [
        { label: "a", data: [1, 2], days: ["d1", "d2"] },
        { label: "empty", data: [] },
      ],
    };

    expect(shapeTrendsResponse(response)).toEqual({
      labels: ["d1", "d2"],
      series: [{ key: "0-a", label: "a", data: [1, 2] }],
    });
  });

  it("drops a series with a non-numeric datapoint rather than reading it as zero", () => {
    const response = {
      results: [
        { label: "gappy", data: [1, null, 3], days: ["d1", "d2", "d3"] },
        { label: "solid", data: [4, 5, 6], days: ["d1", "d2", "d3"] },
      ],
    };

    expect(shapeTrendsResponse(response)?.series).toEqual([
      { key: "1-solid", label: "solid", data: [4, 5, 6] },
    ]);
  });

  it.each([
    { name: "no results", response: { results: [] } },
    { name: "no labels", response: { results: [{ data: [1] }] } },
    { name: "no data", response: { results: [{ days: ["d1"] }] } },
    { name: "a non-object response", response: null },
    {
      name: "only non-numeric series",
      response: { results: [{ data: ["1"], days: ["d1"] }] },
    },
  ])("returns null for $name", ({ response }) => {
    expect(shapeTrendsResponse(response)).toBeNull();
  });
});

describe("reportChartQueryHash", () => {
  it("is stable for the same query", () => {
    const query = { kind: "InsightVizNode", source: { kind: "TrendsQuery" } };

    expect(reportChartQueryHash(query)).toBe(
      reportChartQueryHash({ ...query }),
    );
  });

  it("changes when the query changes", () => {
    const before = reportChartQueryHash({
      kind: "InsightVizNode",
      series: [1],
    });
    const after = reportChartQueryHash({ kind: "InsightVizNode", series: [2] });

    expect(before).not.toBe(after);
  });
});

describe("shapeNumberResponse", () => {
  it("prefers the aggregate the backend computed", () => {
    const response = { results: [{ aggregated_value: 42, label: "Signups" }] };

    expect(shapeNumberResponse(response)).toEqual({
      value: 42,
      label: "Signups",
    });
  });

  it("falls back to count, then to summing the series", () => {
    expect(shapeNumberResponse({ results: [{ count: 7 }] })?.value).toBe(7);
    expect(shapeNumberResponse({ results: [{ data: [1, 2, 3] }] })?.value).toBe(
      6,
    );
  });

  it("returns null when there is no figure to show", () => {
    expect(shapeNumberResponse({ results: [{}] })).toBeNull();
    expect(shapeNumberResponse({ results: [] })).toBeNull();
  });
});

describe("shapeTableResponse", () => {
  it("prints a result grid", () => {
    const response = {
      columns: ["event", "count"],
      results: [
        ["$pageview", 10],
        ["signup", null],
      ],
    };

    expect(shapeTableResponse(response)).toEqual({
      columns: ["event", "count"],
      rows: [
        ["$pageview", "10"],
        ["signup", "—"],
      ],
      truncatedRows: 0,
    });
  });

  it("names columns by position when the response has none", () => {
    const response = { results: [["a", "b"]] };

    expect(shapeTableResponse(response)?.columns).toEqual([
      "Column 1",
      "Column 2",
    ]);
  });

  it("caps rows and reports how many it dropped", () => {
    const response = {
      columns: ["n"],
      results: Array.from({ length: 105 }, (_entry, index) => [index]),
    };

    const shaped = shapeTableResponse(response);
    expect(shaped?.rows).toHaveLength(100);
    expect(shaped?.truncatedRows).toBe(5);
  });

  it("returns null when there is no grid", () => {
    expect(shapeTableResponse({ results: null })).toBeNull();
    expect(shapeTableResponse(null)).toBeNull();
  });
});
