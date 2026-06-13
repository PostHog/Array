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
  it("scalar reads row 0, col 0", async () => {
    const [r] = await serviceReturning([[42]]).run({
      queries: [query("scalar")],
    });
    expect(r).toMatchObject({ ok: true, value: 42 });
  });

  it("column collects the first cell of every row", async () => {
    const [r] = await serviceReturning([[1], [2], [3]]).run({
      queries: [query("column")],
    });
    expect(r).toMatchObject({ ok: true, value: [1, 2, 3] });
  });

  it("labels stringifies the first column", async () => {
    const [r] = await serviceReturning([["Jun 4"], ["Jun 5"]]).run({
      queries: [query("labels")],
    });
    expect(r).toMatchObject({ ok: true, value: ["Jun 4", "Jun 5"] });
  });

  it("matrix keeps every row as an array", async () => {
    const [r] = await serviceReturning([
      ["/", 10, 20],
      ["/pricing", 5, 8],
    ]).run({ queries: [query("matrix")] });
    expect(r).toMatchObject({
      ok: true,
      value: [
        ["/", 10, 20],
        ["/pricing", 5, 8],
      ],
    });
  });

  it("pairs maps rows to {label,value}", async () => {
    const [r] = await serviceReturning([
      ["Direct", 5],
      ["Organic", 3],
    ]).run({ queries: [query("pairs")] });
    expect(r).toMatchObject({
      ok: true,
      value: [
        { label: "Direct", value: 5 },
        { label: "Organic", value: 3 },
      ],
    });
  });

  it("retention maps rows to {label,size,values}", async () => {
    const [r] = await serviceReturning([["Jun 1", 100, 100, 9]]).run({
      queries: [query("retention")],
    });
    expect(r).toMatchObject({
      ok: true,
      value: [{ label: "Jun 1", size: 100, values: [100, 9] }],
    });
  });

  it("fails a scalar that isn't a string/number", async () => {
    const [r] = await serviceReturning([[{ nested: true }]]).run({
      queries: [query("scalar")],
    });
    expect(r.ok).toBe(false);
  });

  it("fails a column whose cells are non-numeric (mis-shaped query)", async () => {
    const [r] = await serviceReturning([["Direct"], ["Organic"]]).run({
      queries: [query("column")],
    });
    expect(r.ok).toBe(false);
  });

  it("treats null column cells as empty buckets (0), not a failure", async () => {
    const [r] = await serviceReturning([[5], [null], [3]]).run({
      queries: [query("column")],
    });
    expect(r).toMatchObject({ ok: true, value: [5, 0, 3] });
  });
});
