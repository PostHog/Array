import { z } from "zod";

// How a query's result rows map onto the target prop:
//   scalar    — one row, one column → a single string/number (Stat value/delta).
//   column    — first cell of every row → number[] (Sparkline data, a chart
//               series' data, a single LineChart series).
//   labels    — first cell of every row → string[] (a chart's x-axis labels).
//   matrix    — every row as an array → (string|number)[][] (Table rows,
//               Heatmap cells).
//   pairs     — every row → { label: row[0], value: row[1] } (BarList/PieChart items).
//   retention — every row → { label: row[0], size: row[1], values: row[2..] }
//               (RetentionGrid cohorts).
export const dashboardQueryShape = z.enum([
  "scalar",
  "column",
  "labels",
  "matrix",
  "pairs",
  "retention",
]);
export type DashboardQueryShape = z.infer<typeof dashboardQueryShape>;

// A single data point to refresh: the element + prop it feeds, and the HogQL
// that produces its value. `column` optionally names a result column to read
// instead of the first one (scalar only). `shape` maps result rows onto the
// prop (default "scalar" for back-compat with existing Stat queries).
export const dashboardQueryInput = z.object({
  elementKey: z.string().min(1),
  propPath: z.string().min(1),
  query: z.string().min(1),
  column: z.string().optional(),
  shape: dashboardQueryShape.default("scalar"),
});
export type DashboardQuery = z.infer<typeof dashboardQueryInput>;

export const dashboardQueryRunInput = z.object({
  queries: z.array(dashboardQueryInput),
});
export type DashboardQueryRunInput = z.infer<typeof dashboardQueryRunInput>;

// Per-point result. Success/failure is encoded (not thrown) so one bad query
// never fails the batch.
export const dashboardQueryResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    elementKey: z.string(),
    propPath: z.string(),
    // A scalar (string/number) or, for the non-scalar shapes, the mapped array /
    // object structure written verbatim onto the target prop.
    value: z.unknown(),
  }),
  z.object({
    ok: z.literal(false),
    elementKey: z.string(),
    propPath: z.string(),
    error: z.string(),
  }),
]);
export type DashboardQueryResult = z.infer<typeof dashboardQueryResultSchema>;
