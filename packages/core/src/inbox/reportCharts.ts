import type { ReportChart, ReportChartSize } from "@posthog/shared";

/**
 * Decides what a report chart's query can be drawn as here, and reshapes the
 * `/query/` response into the plain series/rows a renderer needs.
 *
 * Web draws these with the full insight-visualization stack; the desktop app has
 * a charting library but no insight renderer, so it covers the query shapes that
 * map cleanly onto it and says so plainly for the rest. An unsupported chart
 * still shows its title, caption, and a link out — the evidence stays visible
 * even when the picture can't be drawn locally.
 */

export type ReportChartPlan =
  | { kind: "timeseries"; variant: "line" | "bar" }
  | { kind: "number" }
  | { kind: "table" }
  | { kind: "unsupported"; reason: string };

/** Trends displays that map onto a time-series chart, by variant. */
const LINE_DISPLAYS = new Set([
  "ActionsLineGraph",
  "ActionsLineGraphCumulative",
  "ActionsAreaGraph",
]);
const BAR_DISPLAYS = new Set(["ActionsBar", "ActionsStackedBar"]);

/** Insight query kinds we can't draw, with the label used to explain why. */
const INSIGHT_KIND_LABELS: Record<string, string> = {
  FunnelsQuery: "Funnel",
  RetentionQuery: "Retention",
  PathsQuery: "Paths",
  StickinessQuery: "Stickiness",
  LifecycleQuery: "Lifecycle",
  CalendarHeatmapQuery: "Calendar heatmap",
  FunnelCorrelationQuery: "Funnel correlation",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function unsupported(reason: string): ReportChartPlan {
  return { kind: "unsupported", reason };
}

export function planReportChart(chart: ReportChart): ReportChartPlan {
  const query = chart.query;

  if (query.kind === "DataVisualizationNode") return { kind: "table" };

  if (query.kind === "SavedInsightNode") {
    return unsupported("Saved insights open in PostHog.");
  }

  if (query.kind !== "InsightVizNode") {
    return unsupported("This chart type isn't supported here yet.");
  }

  const source = asRecord(query.source);
  const sourceKind = typeof source?.kind === "string" ? source.kind : null;
  if (sourceKind !== "TrendsQuery") {
    const label = sourceKind ? INSIGHT_KIND_LABELS[sourceKind] : null;
    return unsupported(
      label
        ? `${label} charts open in PostHog.`
        : "This chart type isn't supported here yet.",
    );
  }

  const display = asRecord(source?.trendsFilter)?.display;
  if (typeof display !== "string" || LINE_DISPLAYS.has(display)) {
    // Trends default to a line graph when no display is set.
    return { kind: "timeseries", variant: "line" };
  }
  if (BAR_DISPLAYS.has(display)) return { kind: "timeseries", variant: "bar" };
  if (display === "BoldNumber") return { kind: "number" };
  return unsupported("This chart type isn't supported here yet.");
}

/**
 * A short stable digest of a chart's query, for cache keys. A report can revise
 * a chart's query while keeping its `chart_id` — keying the cached result on the
 * id alone would keep serving the old query's numbers under the new query's
 * title. djb2 over the serialized node: collisions don't matter here, only that
 * the same query always maps to the same key.
 */
export function reportChartQueryHash(query: Record<string, unknown>): string {
  const serialized = JSON.stringify(query);
  let hash = 5381;
  for (let index = 0; index < serialized.length; index++) {
    hash = ((hash << 5) + hash + serialized.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/** Height bucket for a chart, honouring the report's choice when it made one. */
export function resolveReportChartSize(
  chart: ReportChart,
  plan: ReportChartPlan,
): ReportChartSize {
  if (chart.size) return chart.size;
  return plan.kind === "number" ? "small" : "medium";
}

export interface ReportChartSeries {
  key: string;
  label: string;
  data: number[];
}

export interface ReportChartTimeseries {
  series: ReportChartSeries[];
  /** X-axis categories — ISO days for a dated trend, bucket labels otherwise. */
  labels: string[];
}

/**
 * Datapoints, only if every entry really is one. Coercing a null or a string to
 * 0 would draw a dip the backend never reported, so an unexpected entry
 * disqualifies the series instead — a missing series is honest, an invented zero
 * is not.
 */
function numericArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const numbers: number[] = [];
  for (const entry of value) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) return null;
    numbers.push(entry);
  }
  return numbers;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.map((entry) => (typeof entry === "string" ? entry : ""));
}

function responseResults(response: unknown): unknown[] {
  const results = asRecord(response)?.results;
  return Array.isArray(results) ? results : [];
}

/**
 * Trends `/query/` results into parallel series + labels. Series are trimmed to
 * the shortest run so a partial series can't shift the x-axis; a response with
 * no usable series returns null so the caller can show an empty state.
 */
export function shapeTrendsResponse(
  response: unknown,
): ReportChartTimeseries | null {
  const entries = responseResults(response)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  if (entries.length === 0) return null;

  const first = entries[0];
  const labels = stringArray(first.days) ?? stringArray(first.labels);
  if (!labels) return null;

  const series: ReportChartSeries[] = [];
  for (const [index, entry] of entries.entries()) {
    const data = numericArray(entry.data);
    // An empty series carries nothing to draw; skipping it keeps it from
    // collapsing the shared x-axis the other series are plotted against.
    if (!data || data.length === 0) continue;
    const label =
      (typeof entry.label === "string" && entry.label.trim()) ||
      `Series ${index + 1}`;
    series.push({ key: `${index}-${label}`, label, data });
  }
  if (series.length === 0) return null;

  const length = series.reduce(
    (shortest, entry) => Math.min(shortest, entry.data.length),
    labels.length,
  );
  if (length === 0) return null;

  return {
    labels: labels.slice(0, length),
    series: series.map((entry) => ({
      ...entry,
      data: entry.data.slice(0, length),
    })),
  };
}

/**
 * The single figure behind a BoldNumber trend. Prefers the aggregate the backend
 * computed, falling back to summing the series it returned.
 */
export function shapeNumberResponse(
  response: unknown,
): { value: number; label: string } | null {
  const first = asRecord(responseResults(response)[0]);
  if (!first) return null;

  const label =
    (typeof first.label === "string" && first.label.trim()) || "Total";

  for (const key of ["aggregated_value", "count"] as const) {
    const value = first[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return { value, label };
    }
  }

  const data = numericArray(first.data);
  if (!data || data.length === 0) return null;
  return { value: data.reduce((sum, entry) => sum + entry, 0), label };
}

/** Rows kept for a SQL-backed chart; beyond this the chart stops being a chart. */
export const MAX_REPORT_CHART_TABLE_ROWS = 100;

export interface ReportChartTable {
  columns: string[];
  rows: string[][];
  /** Rows dropped past the cap, surfaced so the table doesn't lie by omission. */
  truncatedRows: number;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value) ?? "";
}

/** A `HogQLQuery` result grid into printable columns and rows. */
export function shapeTableResponse(response: unknown): ReportChartTable | null {
  const record = asRecord(response);
  if (!record) return null;

  const rawRows = Array.isArray(record.results) ? record.results : null;
  if (!rawRows) return null;

  const columns = stringArray(record.columns) ?? [];
  const rows = rawRows
    .slice(0, MAX_REPORT_CHART_TABLE_ROWS)
    .map((row) =>
      Array.isArray(row) ? row.map(formatCell) : [formatCell(row)],
    );
  if (columns.length === 0 && rows.length === 0) return null;

  return {
    columns:
      columns.length > 0
        ? columns
        : (rows[0] ?? []).map((_cell, index) => `Column ${index + 1}`),
    rows,
    truncatedRows: Math.max(0, rawRows.length - rows.length),
  };
}
