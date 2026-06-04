import { z } from "zod";

// A json-render Spec (root + flat element map). Stored verbatim; null = empty.
export const dashboardSpecSchema = z.record(z.string(), z.unknown()).nullable();

export const dashboardRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  spec: dashboardSpecSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type DashboardRecord = z.infer<typeof dashboardRecordSchema>;

export const dashboardSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  updatedAt: z.number(),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

export const createDashboardInput = z.object({
  name: z.string().min(1),
  spec: dashboardSpecSchema,
});

export const updateDashboardInput = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  spec: dashboardSpecSchema,
});

export const dashboardIdInput = z.object({ id: z.string().min(1) });
