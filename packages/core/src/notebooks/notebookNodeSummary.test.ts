import { describe, expect, it } from "vitest";
import {
  humanizeDateRange,
  type NotebookNodeJsonObject,
  summarizeNotebookNodeLocally,
} from "./notebookNodeSummary";

describe("humanizeDateRange", () => {
  it.each([
    [{ date_from: "-30d" }, "last 30 days"],
    [{ date_from: "-24h" }, "last 24 hours"],
    [{ date_from: "-1w" }, "last 1 week"],
    [{ date_from: "-90d" }, "last 90 days"],
    [{ date_from: "all" }, "all time"],
    [{ date_from: "dStart" }, "today"],
    [{ date_from: "mStart" }, "this month"],
    [
      { date_from: "2026-01-01", date_to: "2026-02-01" },
      "2026-01-01 to 2026-02-01",
    ],
    [{ date_from: "2026-01-01" }, "since 2026-01-01"],
    [{}, null],
  ])("maps %j to %j", (dateRange, expected) => {
    expect(humanizeDateRange(dateRange as NotebookNodeJsonObject)).toBe(
      expected,
    );
  });

  it("returns null for a null range", () => {
    expect(humanizeDateRange(null)).toBeNull();
  });
});

describe("summarizeNotebookNodeLocally", () => {
  it("summarizes a trends query with breakdown, range and display", () => {
    const props: NotebookNodeJsonObject = {
      query: {
        kind: "InsightVizNode",
        source: {
          kind: "TrendsQuery",
          series: [
            { kind: "EventsNode", event: "$pageview" },
            { kind: "EventsNode", event: "signup", math: "dau" },
          ],
          dateRange: { date_from: "-30d" },
          trendsFilter: { display: "ActionsBar" },
          breakdownFilter: { breakdown: "$browser", breakdown_type: "event" },
        },
      },
    };
    expect(summarizeNotebookNodeLocally("Query", props)).toBe(
      "Trends bar chart, $pageview vs. signup (dau), last 30 days, broken down by $browser",
    );
  });

  it.each([
    [
      "funnel steps in order",
      {
        query: {
          kind: "InsightVizNode",
          source: {
            kind: "FunnelsQuery",
            series: [
              { kind: "EventsNode", event: "$pageview" },
              { kind: "EventsNode", event: "purchase" },
            ],
          },
        },
      },
      "Funnel: $pageview → purchase",
    ],
    [
      "SQL query text",
      {
        query: {
          kind: "HogQLQuery",
          query: "SELECT   event,\n count() FROM events",
        },
      },
      "SQL: SELECT event, count() FROM events",
    ],
    [
      "events table",
      {
        query: {
          kind: "DataTableNode",
          source: { kind: "EventsQuery", after: "-24h", limit: 100 },
        },
      },
      "Events table, last 24 hours, limit 100",
    ],
    [
      "saved insight",
      { query: { kind: "SavedInsightNode", shortId: "AbC123" } },
      "Saved insight AbC123",
    ],
    [
      "retention",
      {
        query: {
          kind: "InsightVizNode",
          source: {
            kind: "RetentionQuery",
            retentionFilter: {
              period: "Week",
              targetEntity: { name: "$pageview" },
              returningEntity: { name: "$pageview" },
            },
          },
        },
      },
      "Retention: $pageview then $pageview, by week",
    ],
    ["unconfigured query", {}, "Query (not configured)"],
  ])("summarizes %s", (_label, props, expected) => {
    expect(
      summarizeNotebookNodeLocally("Query", props as NotebookNodeJsonObject),
    ).toBe(expected);
  });

  it.each([
    ["FeatureFlag", { id: "my-flag" }, "Feature flag my-flag"],
    ["FeatureFlag", {}, "Feature flag (no id)"],
    ["Experiment", { id: 42 }, "Experiment 42"],
    ["Survey", { id: "s-1" }, "Survey s-1"],
    ["Cohort", { id: 7 }, "Cohort 7"],
    ["Person", { distinctId: "user@x.com" }, "Person user@x.com"],
    ["Group", { groupKey: "acme" }, "Group acme"],
    ["Recording", { sessionRecordingId: "rec-9" }, "Session recording rec-9"],
    ["EarlyAccessFeature", { id: "eaf" }, "Early access feature eaf"],
    ["SomethingElse", { foo: 1 }, "Something Else (foo)"],
  ])("summarizes a %s node", (tagName, props, expected) => {
    expect(
      summarizeNotebookNodeLocally(tagName, props as NotebookNodeJsonObject),
    ).toBe(expected);
  });
});
