import { z } from "zod";

// A json-render Spec (root + flat element map). Stored verbatim; null = empty.
export const dashboardSpecSchema = z.record(z.string(), z.unknown()).nullable();

export const dashboardRecordSchema = z.object({
  id: z.string(),
  // The channel (desktop file-system folder) this dashboard belongs to.
  // Defaults to "" so dashboards saved before channel scoping still parse;
  // they read as orphans and get adopted into the default channel on load.
  channelId: z.string().default(""),
  name: z.string(),
  spec: dashboardSpecSchema,
  // The canvas template this board was built with. Defaults to "dashboard" so
  // boards saved before templating still parse and behave as before.
  templateId: z.string().default("dashboard"),
  // Display name of whoever created the file-system row (from the backend's
  // `created_by` user). Absent for rows the API returns without a creator.
  createdBy: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type DashboardRecord = z.infer<typeof dashboardRecordSchema>;

// What a dashboard stores in its desktop file-system row's free-form `meta` JSON
// blob. The FileSystem row itself carries id/path/type/created_at; everything
// below is our own payload that the model has no columns for. Documenting the
// shape here keeps the otherwise-untyped `meta` honest.
export const dashboardFileMetaSchema = z.object({
  // The json-render Spec (root + flat element map). null/absent = empty board.
  spec: dashboardSpecSchema.optional(),
  // The channel folder's stable file-system id. Stored here rather than derived
  // from the path so renaming/moving the channel folder can't reparent the board.
  channelId: z.string().optional(),
  // The canvas template id this board was built with (absent = "dashboard").
  templateId: z.string().optional(),
  // Display name of the creator, stamped at create time. We can't rely on the
  // FS row's `created_by` (the list endpoint doesn't expand it), so we store our
  // own. Absent on boards created before this field existed.
  createdBy: z.string().optional(),
  // Epoch ms. createdAt mirrors the row's created_at; updatedAt is ours because
  // the FileSystem row has no updated_at column to sort the dashboards list by.
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});
export type DashboardFileMeta = z.infer<typeof dashboardFileMetaSchema>;

export const dashboardSummarySchema = z.object({
  id: z.string(),
  channelId: z.string(),
  name: z.string(),
  templateId: z.string().default("dashboard"),
  createdBy: z.string().optional(),
  updatedAt: z.number(),
  // The full spec is already loaded when listing (it rides in the FS row's
  // meta), so include it here to render grid previews without an N+1 of get()s.
  spec: dashboardSpecSchema,
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

export const listDashboardsInput = z.object({ channelId: z.string().min(1) });

export const createDashboardInput = z.object({
  channelId: z.string().min(1),
  name: z.string().min(1),
  spec: dashboardSpecSchema,
  templateId: z.string().default("dashboard"),
});

export const updateDashboardInput = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  spec: dashboardSpecSchema,
});

export const dashboardIdInput = z.object({ id: z.string().min(1) });

// The active time window a dashboard's time-based queries run against. `from`
// and `to` are epoch ms; `name` is the picker label (e.g. "Last 7 days"). Stored
// on the spec under `state.dateRange` so it survives reload and the toolbar
// picker reflects it; queries reference it via `{date_from}` / `{date_to}`.
export const dashboardDateRangeSchema = z.object({
  name: z.string(),
  from: z.number(),
  to: z.number(),
});
export type DashboardDateRange = z.infer<typeof dashboardDateRangeSchema>;

export const refreshDashboardInput = z.object({
  id: z.string().min(1),
  // Limit the refresh to these elements' subtrees (per-card refresh).
  elementKeys: z.array(z.string()).optional(),
  // Skip bumping updatedAt (e.g. for background polling) to avoid reordering.
  touchUpdatedAt: z.boolean().optional(),
  // The time window to substitute into time-based queries. For a rolling named
  // range this is recomputed against now on every refresh, so it's passed each
  // time. Omitted = reuse the stored range.
  dateRange: dashboardDateRangeSchema.optional(),
  // Whether to write `dateRange` onto the spec's `state.dateRange`. Only an
  // explicit user pick persists; auto-rolling refreshes substitute without
  // rewriting the stored range (the stored NAME is enough to re-roll), so a 10s
  // poll doesn't churn the file every tick.
  persistRange: z.boolean().optional(),
});
