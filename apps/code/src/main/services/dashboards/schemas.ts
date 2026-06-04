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
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type DashboardRecord = z.infer<typeof dashboardRecordSchema>;

export const dashboardSummarySchema = z.object({
  id: z.string(),
  channelId: z.string(),
  name: z.string(),
  updatedAt: z.number(),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

export const listDashboardsInput = z.object({ channelId: z.string().min(1) });

export const createDashboardInput = z.object({
  channelId: z.string().min(1),
  name: z.string().min(1),
  spec: dashboardSpecSchema,
});

export const updateDashboardInput = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  spec: dashboardSpecSchema,
});

export const dashboardIdInput = z.object({ id: z.string().min(1) });
