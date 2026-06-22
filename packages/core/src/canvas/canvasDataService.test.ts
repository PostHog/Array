import type { RootLogger } from "@posthog/di/logger";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasDataService } from "./canvasDataService";
import type { InsightFetchResult } from "./posthogApi";

// loadInsight reads a saved insight's stored result via posthogApi; stub the
// module so the service never reaches the network.
const fetchInsightByShortId = vi.fn();
vi.mock("./posthogApi", () => ({
  fetchInsightByShortId: (...args: unknown[]) => fetchInsightByShortId(...args),
  runQuery: vi.fn(),
  fetchCurrentUser: vi.fn(),
}));

// A logger whose .scope() yields a no-op warn (the only method the service uses).
const fakeLogger = {
  scope: () => ({ warn: vi.fn() }),
} as unknown as RootLogger;

function makeService() {
  return new CanvasDataService({} as never, fakeLogger);
}

function insight(partial: Partial<InsightFetchResult>): InsightFetchResult {
  return {
    shortId: "abc123",
    queryKind: "TrendsQuery",
    columns: [],
    results: [],
    hasMore: false,
    ...partial,
  };
}

describe("CanvasDataService.loadInsight", () => {
  beforeEach(() => {
    fetchInsightByShortId.mockReset();
  });

  it("passes a trends-style insight's series objects through untouched", async () => {
    const series = [
      { data: [1, 2, 3], days: ["a", "b", "c"], count: 6, label: "Signups" },
    ];
    fetchInsightByShortId.mockResolvedValue(
      insight({ queryKind: "TrendsQuery", columns: [], results: series }),
    );

    const result = await makeService().loadInsight({ shortId: "abc123" });

    // Series objects must NOT be wrapped in arrays (wrapping reads every value as 0).
    expect(result.results).toBe(series);
    expect(result.columns).toEqual([]);
  });

  it("coerces a SQL insight's scalar rows to 1-cell arrays", async () => {
    fetchInsightByShortId.mockResolvedValue(
      insight({
        queryKind: "HogQLQuery",
        columns: ["count"],
        results: [123, [456]],
      }),
    );

    const result = await makeService().loadInsight({ shortId: "abc123" });

    expect(result.columns).toEqual(["count"]);
    expect(result.results).toEqual([[123], [456]]);
  });

  it("forwards the date-picker window as dateFrom/dateTo", async () => {
    fetchInsightByShortId.mockResolvedValue(insight({}));

    await makeService().loadInsight({
      shortId: "abc123",
      dateRange: { date_from: "2026-01-01", date_to: "2026-02-01" },
    });

    expect(fetchInsightByShortId).toHaveBeenCalledWith(
      expect.anything(),
      "abc123",
      { dateFrom: "2026-01-01", dateTo: "2026-02-01" },
    );
  });

  it("rejects when the insight can't be found", async () => {
    fetchInsightByShortId.mockRejectedValue(
      new Error('Insight "nope" not found'),
    );

    await expect(
      makeService().loadInsight({ shortId: "nope" }),
    ).rejects.toThrow('Insight "nope" not found');
  });
});
