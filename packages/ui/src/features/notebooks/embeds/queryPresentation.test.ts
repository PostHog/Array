import { describe, expect, it } from "vitest";
import { buildPostHogEntityUrl } from "./openInPostHog";
import {
  coerceQueryOutcome,
  deriveQueryTitle,
  unwrapQueryNode,
} from "./queryPresentation";

describe("deriveQueryTitle", () => {
  it.each([
    [null, null],
    [{ kind: "SavedInsightNode", shortId: "abc123" }, "abc123"],
    [{ kind: "SavedInsightNode" }, "Saved insight"],
    [
      {
        kind: "DataTableNode",
        source: { kind: "HogQLQuery", query: "select 1" },
      },
      "SQL",
    ],
    [{ kind: "DataTableNode", source: { kind: "EventsQuery" } }, "Events"],
    [{ kind: "DataTableNode", source: { kind: "ActorsQuery" } }, "People"],
    [{ kind: "InsightVizNode", source: { kind: "TrendsQuery" } }, "Trends"],
    [
      {
        kind: "InsightVizNode",
        source: {
          kind: "TrendsQuery",
          series: [{ event: "$pageview" }, { event: "sign up" }],
        },
      },
      "$pageview, sign up",
    ],
    [{ kind: "InsightVizNode", source: { kind: "FunnelsQuery" } }, "Funnels"],
    [
      { kind: "InsightVizNode", source: { kind: "RetentionQuery" } },
      "Retention",
    ],
    [
      { kind: "InsightVizNode", source: { kind: "WebOverviewQuery" } },
      "Web Overview",
    ],
    // Direct (unwrapped) source nodes
    [{ kind: "EventsQuery" }, "Events"],
    [{ kind: "TrendsQuery", series: [{ event: "$pageview" }] }, "$pageview"],
    [{ kind: "HogQLQuery", query: "select 1" }, "SQL"],
    [{ kind: "SomethingElse" }, null],
  ])("derives title for %j", (query, expected) => {
    expect(deriveQueryTitle(query as Record<string, unknown> | null)).toBe(
      expected,
    );
  });
});

describe("unwrapQueryNode", () => {
  it("unwraps DataTableNode and InsightVizNode to their source", () => {
    const source = { kind: "EventsQuery" };
    expect(unwrapQueryNode({ kind: "DataTableNode", source })).toBe(source);
    expect(unwrapQueryNode({ kind: "InsightVizNode", source })).toBe(source);
  });

  it("returns other nodes unchanged", () => {
    const query = { kind: "TrendsQuery" };
    expect(unwrapQueryNode(query)).toBe(query);
  });
});

describe("coerceQueryOutcome", () => {
  it("coerces columns + results into a table", () => {
    const outcome = coerceQueryOutcome({
      columns: ["event", "count"],
      results: [
        ["$pageview", 10],
        ["sign up", 2],
      ],
    });
    expect(outcome).toEqual({
      kind: "table",
      columns: ["event", "count"],
      rows: [
        ["$pageview", 10],
        ["sign up", 2],
      ],
    });
  });

  it("coerces series with data arrays into trends", () => {
    const outcome = coerceQueryOutcome({
      results: [{ label: "$pageview", data: [1, 2, 3], days: ["a", "b", "c"] }],
    });
    expect(outcome.kind).toBe("trends");
  });

  it("coerces funnel steps with conversion vs the first step", () => {
    const outcome = coerceQueryOutcome({
      results: [
        { action_id: "$pageview", name: "$pageview", count: 200, order: 0 },
        { action_id: "sign up", name: "sign up", count: 50, order: 1 },
        { action_id: "purchase", name: "purchase", count: 10, order: 2 },
      ],
    });
    expect(outcome).toEqual({
      kind: "funnel",
      steps: [
        { name: "$pageview", count: 200, conversionRate: null },
        { name: "sign up", count: 50, conversionRate: 0.25 },
        { name: "purchase", count: 10, conversionRate: 0.05 },
      ],
    });
  });

  it("prefers a funnel step's custom_name and falls back to action_id", () => {
    const outcome = coerceQueryOutcome({
      results: [
        { action_id: 1, custom_name: "Landed", count: 4 },
        { action_id: 2, count: 2 },
      ],
    });
    expect(outcome.kind).toBe("funnel");
    if (outcome.kind === "funnel") {
      expect(outcome.steps.map((step) => step.name)).toEqual(["Landed", "2"]);
    }
  });

  it("uses the first group of a breakdown funnel", () => {
    const outcome = coerceQueryOutcome({
      results: [
        [
          { name: "$pageview", count: 10 },
          { name: "sign up", count: 5 },
        ],
        [
          { name: "$pageview", count: 8 },
          { name: "sign up", count: 1 },
        ],
      ],
    });
    expect(outcome.kind).toBe("funnel");
    if (outcome.kind === "funnel") {
      expect(outcome.steps).toHaveLength(2);
      expect(outcome.steps[1]).toEqual({
        name: "sign up",
        count: 5,
        conversionRate: 0.5,
      });
    }
  });

  it("coerces retention rows into percentage rows", () => {
    const outcome = coerceQueryOutcome({
      results: [
        {
          date: "2026-07-01",
          label: "Week 0",
          values: [{ count: 100 }, { count: 40 }, { count: 10 }],
        },
        {
          date: "2026-07-08",
          label: "Week 1",
          values: [{ count: 0 }, { count: 0 }],
        },
      ],
    });
    expect(outcome).toEqual({
      kind: "retention",
      rows: [
        {
          label: "Week 0",
          initialCount: 100,
          percentages: [100, 40, 10],
        },
        {
          label: "Week 1",
          initialCount: 0,
          percentages: [null, null],
        },
      ],
    });
  });

  it.each([
    [null],
    ["plain string"],
    [{ results: "not an array" }],
    [{ results: [{ unrelated: true }] }],
  ])("falls back to json for %j", (response) => {
    expect(coerceQueryOutcome(response).kind).toBe("json");
  });
});

describe("buildPostHogEntityUrl", () => {
  it.each([
    [
      { kind: "featureFlag", id: "42" } as const,
      "https://us.posthog.com/project/7/feature_flags/42",
    ],
    [
      { kind: "experiment", id: "5" } as const,
      "https://us.posthog.com/project/7/experiments/5",
    ],
    [
      { kind: "survey", id: "s-1" } as const,
      "https://us.posthog.com/project/7/surveys/s-1",
    ],
    [
      { kind: "earlyAccessFeature", id: "e-1" } as const,
      "https://us.posthog.com/project/7/early_access_features/e-1",
    ],
    [
      { kind: "cohort", id: "9" } as const,
      "https://us.posthog.com/project/7/cohorts/9",
    ],
    [
      { kind: "person", id: "uuid-1" } as const,
      "https://us.posthog.com/project/7/person/uuid-1",
    ],
    [
      { kind: "replay", id: "r-1" } as const,
      "https://us.posthog.com/project/7/replay/r-1",
    ],
    [
      { kind: "replay", id: "r-1", timestampSeconds: 12.7 } as const,
      "https://us.posthog.com/project/7/replay/r-1?t=12",
    ],
  ])("builds %j", (entity, expected) => {
    expect(buildPostHogEntityUrl("https://us.posthog.com", 7, entity)).toBe(
      expected,
    );
  });

  it("strips a trailing slash from the host", () => {
    expect(
      buildPostHogEntityUrl("https://us.posthog.com/", 7, {
        kind: "cohort",
        id: "1",
      }),
    ).toBe("https://us.posthog.com/project/7/cohorts/1");
  });
});
