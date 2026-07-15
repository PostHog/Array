// Deterministic, instant summaries of notebook component nodes. These render
// immediately when a node enters edit mode; the AI summary (see
// NotebookNodeAIService) streams in afterwards to replace/enrich them. Pure
// functions only — no I/O, no React.

export type NotebookNodeJsonValue =
  | string
  | number
  | boolean
  | null
  | NotebookNodeJsonValue[]
  | { [key: string]: NotebookNodeJsonValue };

export type NotebookNodeJsonObject = Record<string, NotebookNodeJsonValue>;

function asObject(value: unknown): NotebookNodeJsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as NotebookNodeJsonObject)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asIdentifier(value: unknown): string | null {
  if (typeof value === "number") return String(value);
  return asString(value);
}

/** "TrendsQuery" → "Trends", "WebOverviewQuery" → "Web overview". */
function cleanQueryKind(kind: string): string {
  const spaced = kind.replace(/Query$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0) + spaced.slice(1).toLowerCase();
}

const DISPLAY_LABELS: Record<string, string> = {
  ActionsLineGraph: "line chart",
  ActionsLineGraphCumulative: "cumulative line chart",
  ActionsAreaGraph: "area chart",
  ActionsBar: "bar chart",
  ActionsBarValue: "value bar chart",
  ActionsPie: "pie chart",
  ActionsTable: "table",
  BoldNumber: "big number",
  WorldMap: "world map",
};

/** "-30d" → "last 30 days", "-24h" → "last 24 hours", "mStart" → "this month". */
export function humanizeDateRange(
  dateRange: NotebookNodeJsonObject | null,
): string | null {
  if (!dateRange) return null;
  const from = asString(dateRange.date_from);
  const to = asString(dateRange.date_to);
  if (!from) return null;
  if (from === "all") return "all time";
  if (from === "dStart") return "today";
  if (from === "-1dStart") return "yesterday";
  if (from === "mStart") return "this month";
  if (from === "yStart") return "this year";
  const relative = /^-(\d+)([hdwmy])$/.exec(from);
  if (relative) {
    const count = Number(relative[1]);
    const unit = { h: "hour", d: "day", w: "week", m: "month", y: "year" }[
      relative[2] as "h" | "d" | "w" | "m" | "y"
    ];
    return `last ${count} ${unit}${count === 1 ? "" : "s"}`;
  }
  if (to) return `${from} to ${to}`;
  return `since ${from}`;
}

function describeSeries(source: NotebookNodeJsonObject): string[] {
  const series = Array.isArray(source.series) ? source.series : [];
  const labels: string[] = [];
  for (const entry of series) {
    const item = asObject(entry);
    if (!item) continue;
    const label =
      asString(item.custom_name) ??
      asString(item.name) ??
      asString(item.event) ??
      (item.kind === "ActionsNode" && item.id != null
        ? `action ${String(item.id)}`
        : null);
    if (!label) continue;
    const math = asString(item.math);
    labels.push(math && math !== "total" ? `${label} (${math})` : label);
  }
  return labels;
}

function describeBreakdown(source: NotebookNodeJsonObject): string | null {
  const filter = asObject(source.breakdownFilter);
  if (!filter) return null;
  const multi = Array.isArray(filter.breakdowns)
    ? filter.breakdowns
        .map((entry) => asString(asObject(entry)?.property))
        .filter((property): property is string => property !== null)
    : [];
  const single = asString(filter.breakdown);
  const properties = multi.length ? multi : single ? [single] : [];
  return properties.length ? `broken down by ${properties.join(", ")}` : null;
}

function summarizeQueryNode(query: NotebookNodeJsonObject): string {
  const kind = asString(query.kind);
  if (!kind) return "Query (no kind set)";
  if (kind === "SavedInsightNode") {
    return `Saved insight ${asString(query.shortId) ?? ""}`.trim();
  }

  const wrapped =
    (kind === "InsightVizNode" || kind === "DataTableNode") &&
    asObject(query.source)
      ? asObject(query.source)
      : null;
  const source = wrapped ?? query;
  const sourceKind = asString(source.kind);
  if (!sourceKind) return "Query (no kind set)";

  const dateRange = humanizeDateRange(asObject(source.dateRange));
  const parts: string[] = [];

  switch (sourceKind) {
    case "TrendsQuery": {
      const display = asString(asObject(source.trendsFilter)?.display);
      const displayLabel = display ? DISPLAY_LABELS[display] : null;
      const series = describeSeries(source);
      parts.push(`Trends ${displayLabel ?? "line chart"}`);
      if (series.length) parts.push(series.join(" vs. "));
      if (dateRange) parts.push(dateRange);
      const breakdown = describeBreakdown(source);
      if (breakdown) parts.push(breakdown);
      const interval = asString(source.interval);
      if (interval && interval !== "day") parts.push(`by ${interval}`);
      break;
    }
    case "FunnelsQuery": {
      const series = describeSeries(source);
      parts.push(
        series.length ? `Funnel: ${series.join(" → ")}` : "Funnel (no steps)",
      );
      if (dateRange) parts.push(dateRange);
      break;
    }
    case "RetentionQuery": {
      const filter = asObject(source.retentionFilter);
      const target = asString(asObject(filter?.targetEntity)?.name);
      const returning = asString(asObject(filter?.returningEntity)?.name);
      const period = asString(filter?.period);
      parts.push(
        target && returning
          ? `Retention: ${target} then ${returning}`
          : "Retention",
      );
      if (period) parts.push(`by ${period.toLowerCase()}`);
      if (dateRange) parts.push(dateRange);
      break;
    }
    case "PathsQuery":
      parts.push("User paths");
      if (dateRange) parts.push(dateRange);
      break;
    case "StickinessQuery":
    case "LifecycleQuery": {
      const series = describeSeries(source);
      parts.push(sourceKind === "StickinessQuery" ? "Stickiness" : "Lifecycle");
      if (series.length) parts.push(series.join(", "));
      if (dateRange) parts.push(dateRange);
      break;
    }
    case "HogQLQuery": {
      const sql = asString(source.query)?.replace(/\s+/g, " ") ?? "";
      parts.push(sql ? `SQL: ${truncate(sql, 100)}` : "SQL query");
      break;
    }
    case "EventsQuery": {
      parts.push("Events table");
      const after = asString(source.after);
      if (after) {
        parts.push(humanizeDateRange({ date_from: after }) ?? `after ${after}`);
      }
      if (typeof source.limit === "number") {
        parts.push(`limit ${source.limit}`);
      }
      break;
    }
    case "ActorsQuery":
      parts.push("People table");
      break;
    default:
      parts.push(cleanQueryKind(sourceKind));
      if (dateRange) parts.push(dateRange);
  }
  return parts.join(", ");
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * Instant human-readable summary of a node's props. Never throws; unknown
 * shapes fall back to a generic label so the edit panel always has something
 * to show before (or without) the AI summary.
 */
export function summarizeNotebookNodeLocally(
  tagName: string,
  props: NotebookNodeJsonObject,
): string {
  switch (tagName) {
    case "Query": {
      const query = asObject(props.query);
      return query ? summarizeQueryNode(query) : "Query (not configured)";
    }
    case "FeatureFlag": {
      const id = asIdentifier(props.id);
      return id ? `Feature flag ${id}` : "Feature flag (no id)";
    }
    case "Experiment": {
      const id = asIdentifier(props.id);
      return id ? `Experiment ${id}` : "Experiment (no id)";
    }
    case "Survey": {
      const id = asIdentifier(props.id);
      return id ? `Survey ${id}` : "Survey (no id)";
    }
    case "EarlyAccessFeature": {
      const id = asIdentifier(props.id);
      return id ? `Early access feature ${id}` : "Early access feature (no id)";
    }
    case "Cohort": {
      const id = asIdentifier(props.id);
      return id ? `Cohort ${id}` : "Cohort (no id)";
    }
    case "Person": {
      const id = asIdentifier(props.distinctId) ?? asIdentifier(props.id);
      return id ? `Person ${id}` : "Person (no id)";
    }
    case "Group": {
      const key = asIdentifier(props.groupKey) ?? asIdentifier(props.id);
      return key ? `Group ${key}` : "Group (no key)";
    }
    case "Recording": {
      const id =
        asIdentifier(props.sessionRecordingId) ?? asIdentifier(props.id);
      return id ? `Session recording ${id}` : "Session recording (no id)";
    }
    default: {
      const label = tagName.replace(/([a-z])([A-Z])/g, "$1 $2");
      const keys = Object.keys(props);
      return keys.length ? `${label} (${keys.join(", ")})` : label;
    }
  }
}
