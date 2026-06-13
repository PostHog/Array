import type { AuthService } from "@posthog/core/auth/auth";
import { AUTH_SERVICE } from "@posthog/core/auth/auth.module";
import {
  ROOT_LOGGER,
  type RootLogger,
  type ScopedLogger,
} from "@posthog/di/logger";
import { inject, injectable } from "inversify";
import type {
  DashboardQuery,
  DashboardQueryResult,
  DashboardQueryRunInput,
} from "./querySchemas";

// Run at most this many HogQL queries at once so a wide dashboard doesn't
// hammer the query endpoint.
const CONCURRENCY = 5;

interface HogQLResponse {
  results?: unknown[];
  columns?: string[];
  error?: string | null;
}

// Executes the HogQL queries stored on a dashboard's data points and returns a
// single scalar value per point. Used by the dashboard refresh flow.
@injectable()
export class DashboardQueryService {
  private readonly log: ScopedLogger;

  constructor(
    @inject(AUTH_SERVICE)
    private readonly authService: AuthService,
    @inject(ROOT_LOGGER)
    rootLogger: RootLogger,
  ) {
    this.log = rootLogger.scope("dashboard-query");
  }

  async run(input: DashboardQueryRunInput): Promise<DashboardQueryResult[]> {
    const { queries } = input;
    if (queries.length === 0) return [];

    const { apiHost } = await this.authService.getValidAccessToken();
    const projectId = this.authService.getState().currentProjectId;
    if (projectId == null) {
      return queries.map((q) => this.fail(q, "No PostHog project selected"));
    }

    const url = `${apiHost}/api/projects/${projectId}/query/`;
    const results: DashboardQueryResult[] = [];

    // Simple capped batches; preserves input order in the output.
    for (let i = 0; i < queries.length; i += CONCURRENCY) {
      const batch = queries.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map((q) => this.runOne(url, q)),
      );
      settled.forEach((s, j) => {
        results.push(
          s.status === "fulfilled"
            ? s.value
            : this.fail(batch[j], errorMessage(s.reason)),
        );
      });
    }

    return results;
  }

  private async runOne(
    url: string,
    q: DashboardQuery,
  ): Promise<DashboardQueryResult> {
    const response = await this.authService.authenticatedFetch(fetch, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query: q.query } }),
    });

    if (!response.ok) {
      return this.fail(q, `Query failed (${response.status})`);
    }

    const body = (await response.json()) as HogQLResponse;
    if (body.error) return this.fail(q, body.error);

    const rows = body.results;
    if (!Array.isArray(rows) || rows.length === 0) {
      return this.fail(q, "Query returned no rows");
    }

    const grid = rows.filter((r): r is unknown[] => Array.isArray(r));
    if (grid.length === 0) {
      return this.fail(q, "Unexpected result shape");
    }

    const value = this.mapShape(q, grid, body.columns);
    if (value === undefined) {
      return this.fail(
        q,
        `Query result didn't match the "${q.shape}" shape (a column expected to be numeric wasn't)`,
      );
    }
    return {
      ok: true,
      elementKey: q.elementKey,
      propPath: q.propPath,
      value,
    };
  }

  // Project the result grid onto the target prop per the query's shape. Returns
  // `undefined` to FAIL the point when a column that must be numeric isn't (a
  // mis-shaped query — e.g. a chart series pointed at a label column — so the
  // user sees an error instead of a silently-zeroed chart). `null` cells are a
  // legit empty bucket (→ 0); only non-numeric NON-null cells fail.
  private mapShape(
    q: DashboardQuery,
    grid: unknown[][],
    columns?: string[],
  ): unknown {
    switch (q.shape) {
      case "column": {
        const out = grid.map((r) => numOrNull(r[0]));
        return out.includes(null) ? undefined : out;
      }
      case "labels":
        return grid.map((r) => str(r[0]));
      case "matrix":
        // Mixed string/number cells (Table rows, Heatmap) — kept lenient.
        return grid.map((r) => r.map(cell));
      case "pairs": {
        const out = grid.map((r) => ({
          label: str(r[0]),
          value: numOrNull(r[1]),
        }));
        return out.some((p) => p.value === null) ? undefined : out;
      }
      case "retention": {
        const out = grid.map((r) => ({
          label: str(r[0]),
          size: numOrNull(r[1]),
          values: r.slice(2).map(numOrNull),
        }));
        const bad = out.some((c) => c.size === null || c.values.includes(null));
        return bad ? undefined : out;
      }
      default: {
        // scalar: the named column if given, else the first cell of the first row.
        const colIndex = q.column && columns ? columns.indexOf(q.column) : 0;
        const c = grid[0]?.[colIndex >= 0 ? colIndex : 0];
        return typeof c === "number" || typeof c === "string" ? c : undefined;
      }
    }
  }

  private fail(q: DashboardQuery, error: string): DashboardQueryResult {
    this.log.warn("Dashboard query failed", {
      elementKey: q.elementKey,
      propPath: q.propPath,
      error,
    });
    return { ok: false, elementKey: q.elementKey, propPath: q.propPath, error };
  }
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

// Numeric coercion for chart/number columns: `null` (an empty bucket) → 0, a
// finite number or numeric string → that number, and anything else → `null` to
// SIGNAL a mis-shaped column (the caller fails the point rather than charting 0s).
function numOrNull(v: unknown): number | null {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

// A raw matrix cell: keep numbers as numbers, everything else as a string.
function cell(v: unknown): string | number {
  return typeof v === "number" ? v : str(v);
}
