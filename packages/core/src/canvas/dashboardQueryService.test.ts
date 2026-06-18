import { describe, expect, it } from "vitest";
import { DashboardQueryService } from "./dashboardQueryService";
import type { DashboardQuery } from "./querySchemas";

// A fake AuthService that returns canned HogQL responses keyed by query string,
// so we can exercise the shape-mapping without a real PostHog backend.
function serviceReturning(rows: unknown[], columns?: string[]) {
  const authService = {
    getValidAccessToken: async () => ({ apiHost: "https://x" }),
    getState: () => ({ currentProjectId: 1 }),
    authenticatedFetch: async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ results: rows, columns }),
      }) as unknown as Response,
  };
  const logger = {
    scope: () => ({ warn() {} }),
  };
  // biome-ignore lint/suspicious/noExplicitAny: faking only the used surface
  return new DashboardQueryService(authService as any, logger as any);
}

function query(shape: DashboardQuery["shape"]): DashboardQuery {
  return { elementKey: "el", propPath: "/p", query: "SELECT 1", shape };
}

describe("DashboardQueryService shape mapping", () => {
  it.each<{
    name: string;
    shape: DashboardQuery["shape"];
    rows: unknown[];
    value: unknown;
  }>([
    {
      name: "scalar reads row 0, col 0",
      shape: "scalar",
      rows: [[42]],
      value: 42,
    },
    {
      name: "column collects the first cell of every row",
      shape: "column",
      rows: [[1], [2], [3]],
      value: [1, 2, 3],
    },
    {
      name: "labels stringifies the first column",
      shape: "labels",
      rows: [["Jun 4"], ["Jun 5"]],
      value: ["Jun 4", "Jun 5"],
    },
    {
      name: "matrix keeps every row as an array",
      shape: "matrix",
      rows: [
        ["/", 10, 20],
        ["/pricing", 5, 8],
      ],
      value: [
        ["/", 10, 20],
        ["/pricing", 5, 8],
      ],
    },
    {
      name: "pairs maps rows to {label,value}",
      shape: "pairs",
      rows: [
        ["Direct", 5],
        ["Organic", 3],
      ],
      value: [
        { label: "Direct", value: 5 },
        { label: "Organic", value: 3 },
      ],
    },
    {
      name: "retention maps rows to {label,size,values}",
      shape: "retention",
      rows: [["Jun 1", 100, 100, 9]],
      value: [{ label: "Jun 1", size: 100, values: [100, 9] }],
    },
    {
      name: "treats null column cells as empty buckets (0), not a failure",
      shape: "column",
      rows: [[5], [null], [3]],
      value: [5, 0, 3],
    },
  ])("$name", async ({ shape, rows, value }) => {
    const [r] = await serviceReturning(rows).run({ queries: [query(shape)] });
    expect(r).toMatchObject({ ok: true, value });
  });

  it.each<{ name: string; shape: DashboardQuery["shape"]; rows: unknown[] }>([
    {
      name: "fails a scalar that isn't a string/number",
      shape: "scalar",
      rows: [[{ nested: true }]],
    },
    {
      name: "fails a column whose cells are non-numeric (mis-shaped query)",
      shape: "column",
      rows: [["Direct"], ["Organic"]],
    },
  ])("$name", async ({ shape, rows }) => {
    const [r] = await serviceReturning(rows).run({ queries: [query(shape)] });
    expect(r.ok).toBe(false);
  });
});
