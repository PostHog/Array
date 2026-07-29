/**
 * Contract for the charts a Self-driving report carries, mirroring the backend
 * `ReportChart` (`products/signals/backend/report_charts.py`, PostHog/posthog#73733).
 *
 * A report summary places a chart inline with a `[label](chart:<chart_id>)`
 * link; charts nothing references render after the prose. The limits below are
 * the backend's, re-declared here because we re-validate on read: a chart's
 * `query` is POSTed back to `/api/projects/:id/query/` to draw it, so the
 * client decides for itself which query nodes it is willing to execute rather
 * than trusting the payload.
 */

/** Markdown link scheme a summary uses to place a chart. */
const REPORT_CHART_REF_PREFIX = "chart:";

/** `chart_id` shape the backend accepts: lowercase slug of letters, digits, `_`, `-`. */
const REPORT_CHART_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export const MAX_REPORT_CHARTS = 20;
const MAX_REPORT_CHART_ID_LENGTH = 100;
export const MAX_REPORT_CHART_TITLE_LENGTH = 200;
export const MAX_REPORT_CHART_CAPTION_LENGTH = 500;

/**
 * Query node kinds a report chart may carry. The backend validates writes
 * against the same set; anything else is dropped on read instead of executed.
 */
const REPORT_CHART_QUERY_KINDS = [
  "InsightVizNode",
  "DataVisualizationNode",
  "SavedInsightNode",
] as const;

type ReportChartQueryKind = (typeof REPORT_CHART_QUERY_KINDS)[number];

/**
 * Query kinds that run caller-supplied code server-side. The backend refuses to
 * store a chart with one of these nested anywhere in its query; we refuse to
 * keep one, so such a query never reaches the query endpoint from here either.
 */
const FORBIDDEN_QUERY_KINDS = new Set(["HogQuery", "SuggestedQuestionsQuery"]);

/** Object keys that smuggle executable payloads into an otherwise benign node. */
const FORBIDDEN_QUERY_KEYS = new Set(["bytecode", "sendRawQuery"]);

/** Guards the recursive scan against a pathologically nested payload. */
const MAX_QUERY_DEPTH = 100;

export type ReportChartSize = "small" | "medium" | "large";

const REPORT_CHART_SIZES: readonly ReportChartSize[] = [
  "small",
  "medium",
  "large",
];

/** One chart attached to a report — drawn inline in the summary or below it. */
export interface ReportChart {
  chart_id: string;
  title: string;
  /** Query node to render. `kind` is one of `REPORT_CHART_QUERY_KINDS`. */
  query: Record<string, unknown>;
  caption?: string | null;
  size?: ReportChartSize | null;
}

export function isReportChartId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_REPORT_CHART_ID_LENGTH &&
    REPORT_CHART_ID_PATTERN.test(value)
  );
}

export function isReportChartSize(value: unknown): value is ReportChartSize {
  return (
    typeof value === "string" &&
    REPORT_CHART_SIZES.includes(value as ReportChartSize)
  );
}

export function isReportChartQueryKind(
  value: unknown,
): value is ReportChartQueryKind {
  return (
    typeof value === "string" &&
    REPORT_CHART_QUERY_KINDS.includes(value as ReportChartQueryKind)
  );
}

/**
 * The `chart_id` a markdown link target references, or null when the href isn't
 * a chart reference. Used both to place charts while splitting a summary and to
 * keep `chart:` hrefs from rendering as broken anchors.
 */
export function matchReportChartRef(
  href: string | null | undefined,
): string | null {
  if (!href || !href.startsWith(REPORT_CHART_REF_PREFIX)) return null;
  const chartId = href.slice(REPORT_CHART_REF_PREFIX.length);
  return isReportChartId(chartId) ? chartId : null;
}

/**
 * Whether a query node carries an executable payload anywhere inside it. A
 * chart's own `kind` is checked separately; this catches one nested in a
 * `source`, a series entry, or a filter.
 */
export function hasForbiddenReportChartQueryNode(
  value: unknown,
  depth = 0,
): boolean {
  if (depth > MAX_QUERY_DEPTH) return true;
  if (Array.isArray(value)) {
    return value.some((entry) =>
      hasForbiddenReportChartQueryNode(entry, depth + 1),
    );
  }
  if (typeof value !== "object" || value === null) return false;

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_QUERY_KEYS.has(key)) return true;
  }
  if (typeof record.kind === "string" && FORBIDDEN_QUERY_KINDS.has(record.kind))
    return true;

  return Object.values(record).some((entry) =>
    hasForbiddenReportChartQueryNode(entry, depth + 1),
  );
}
