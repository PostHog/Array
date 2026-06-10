import { z } from "zod";

// A single data point to refresh: the element + prop it feeds, and the HogQL
// that produces its value. `column` optionally names a result column to read
// instead of the first one.
export const dashboardQueryInput = z.object({
  elementKey: z.string().min(1),
  propPath: z.string().min(1),
  query: z.string().min(1),
  column: z.string().optional(),
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
    value: z.union([z.string(), z.number()]),
  }),
  z.object({
    ok: z.literal(false),
    elementKey: z.string(),
    propPath: z.string(),
    error: z.string(),
  }),
]);
export type DashboardQueryResult = z.infer<typeof dashboardQueryResultSchema>;
