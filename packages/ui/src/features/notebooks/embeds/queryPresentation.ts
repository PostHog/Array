/**
 * Pure presentation helpers for notebook `<Query …/>` blocks: title
 * derivation (mirroring the webapp's `getQueryComponentTitle`) and defensive
 * coercion of `/query` responses into renderable outcomes.
 */

export type TrendsSeries = {
  label?: string;
  data?: number[];
  labels?: string[];
  days?: string[];
};

export interface FunnelStepSummary {
  name: string;
  count: number;
  /** Conversion vs the first step, 0..1. Null for the first step. */
  conversionRate: number | null;
}

export interface RetentionRowSummary {
  label: string;
  initialCount: number;
  /** Percentage retained per period vs the row's initial count, 0..100. */
  percentages: (number | null)[];
}

export type QueryOutcome =
  | { kind: "trends"; series: TrendsSeries[] }
  | { kind: "funnel"; steps: FunnelStepSummary[] }
  | { kind: "retention"; rows: RetentionRowSummary[] }
  | { kind: "table"; columns: string[]; rows: unknown[][] }
  | { kind: "json"; value: unknown };

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Unwrap presentation wrappers (DataTableNode, InsightVizNode) to the
 * executable source node, mirroring how the webapp resolves query nodes.
 */
export function unwrapQueryNode(
  query: Record<string, unknown>,
): Record<string, unknown> {
  const kind = query.kind;
  if (
    (kind === "DataTableNode" || kind === "InsightVizNode") &&
    query.source &&
    typeof query.source === "object"
  ) {
    return query.source as Record<string, unknown>;
  }
  return query;
}

/** "TrendsQuery" → "Trends", "WebOverviewQuery" → "Web Overview". */
function cleanQueryKind(kind: string): string {
  return kind.replace(/Query$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function seriesEventNames(source: Record<string, unknown>): string | null {
  const series = source.series;
  if (!Array.isArray(series)) return null;
  const names = series
    .map((entry) => asString(asObject(entry)?.event))
    .filter((name): name is string => name !== null);
  return names.length > 0 ? names.join(", ") : null;
}

/**
 * Derive a display title from the query node itself. Callers layer the
 * explicit `title` prop and (for SavedInsightNode) the fetched insight name
 * on top: explicit title ?? fetched name ?? deriveQueryTitle(query).
 */
export function deriveQueryTitle(
  query: Record<string, unknown> | null,
): string | null {
  if (!query) return null;
  const kind = asString(query.kind);
  if (!kind) return null;

  if (kind === "SavedInsightNode") {
    return asString(query.shortId) ?? "Saved insight";
  }

  const source = unwrapQueryNode(query);
  const sourceKind = asString(source.kind);
  if (!sourceKind) return null;

  if (sourceKind === "HogQLQuery") return "SQL";
  if (sourceKind === "EventsQuery") return "Events";
  if (sourceKind === "ActorsQuery") return "People";
  if (sourceKind === "TrendsQuery") {
    return seriesEventNames(source) ?? "Trends";
  }
  if (sourceKind.endsWith("Query")) return cleanQueryKind(sourceKind);
  return null;
}

function coerceTable(body: {
  columns?: unknown;
  results?: unknown;
}): QueryOutcome | null {
  if (!Array.isArray(body.columns) || !Array.isArray(body.results)) {
    return null;
  }
  return {
    kind: "table",
    columns: body.columns.map(String),
    rows: body.results.map((row) =>
      Array.isArray(row) ? row : [JSON.stringify(row)],
    ),
  };
}

function coerceTrends(results: unknown[]): QueryOutcome | null {
  const isSeries = results.every(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      Array.isArray((entry as TrendsSeries).data),
  );
  return isSeries && results.length > 0
    ? { kind: "trends", series: results as TrendsSeries[] }
    : null;
}

function coerceFunnel(results: unknown[]): QueryOutcome | null {
  // Breakdown funnels nest steps one level deeper; render the first group.
  const flat =
    results.length > 0 && results.every((entry) => Array.isArray(entry))
      ? (results[0] as unknown[])
      : results;
  const stepLike = flat.every((entry) => {
    const step = asObject(entry);
    return (
      step !== null &&
      typeof step.count === "number" &&
      (typeof step.name === "string" ||
        step.action_id !== undefined ||
        typeof step.custom_name === "string")
    );
  });
  if (!stepLike || flat.length === 0) return null;

  const steps = flat.map((entry) => asObject(entry) ?? {});
  const first = steps[0]?.count;
  const firstCount = typeof first === "number" && first > 0 ? first : null;
  return {
    kind: "funnel",
    steps: steps.map((step, index) => {
      const count = typeof step.count === "number" ? step.count : 0;
      return {
        name:
          asString(step.custom_name) ??
          asString(step.name) ??
          (step.action_id != null
            ? String(step.action_id)
            : `Step ${index + 1}`),
        count,
        conversionRate:
          index === 0 || firstCount === null ? null : count / firstCount,
      };
    }),
  };
}

function coerceRetention(results: unknown[]): QueryOutcome | null {
  const rowLike = results.every((entry) => {
    const row = asObject(entry);
    return (
      row !== null &&
      Array.isArray(row.values) &&
      row.values.every((value) => typeof asObject(value)?.count === "number") &&
      (typeof row.date === "string" || typeof row.label === "string")
    );
  });
  if (!rowLike || results.length === 0) return null;

  return {
    kind: "retention",
    rows: results.map((entry) => {
      const row = asObject(entry) ?? {};
      const values = (Array.isArray(row.values) ? row.values : []).map(
        (value) => {
          const count = asObject(value)?.count;
          return typeof count === "number" ? count : 0;
        },
      );
      const initialCount = values[0] ?? 0;
      return {
        label: asString(row.label) ?? asString(row.date) ?? "",
        initialCount,
        percentages: values.map((count) =>
          initialCount > 0 ? (count / initialCount) * 100 : null,
        ),
      };
    }),
  };
}

/** Coerce a `/query` response into a renderable outcome, falling back to JSON. */
export function coerceQueryOutcome(response: unknown): QueryOutcome {
  const body = asObject(response);
  if (body) {
    const table = coerceTable(body);
    if (table) return table;
    const results = body.results;
    if (Array.isArray(results)) {
      const outcome =
        coerceTrends(results) ??
        coerceRetention(results) ??
        coerceFunnel(results);
      if (outcome) return outcome;
    }
  }
  return { kind: "json", value: response };
}
