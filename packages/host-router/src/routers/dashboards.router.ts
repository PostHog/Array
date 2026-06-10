import {
  createDashboardInput,
  dashboardIdInput,
  dashboardRecordSchema,
  dashboardSummarySchema,
  listDashboardsInput,
  refreshDashboardInput,
  updateDashboardInput,
} from "@posthog/core/canvas/dashboardSchemas";
import { DASHBOARDS_SERVICE } from "@posthog/core/canvas/identifiers";
import type { IDashboardsService } from "@posthog/core/canvas/services";
import { publicProcedure, router } from "@posthog/host-trpc/trpc";
import { z } from "zod";

export const dashboardsRouter = router({
  list: publicProcedure
    .input(listDashboardsInput)
    .output(z.array(dashboardSummarySchema))
    .query(({ ctx, input }) =>
      ctx.container
        .get<IDashboardsService>(DASHBOARDS_SERVICE)
        .list(input.channelId),
    ),
  get: publicProcedure
    .input(dashboardIdInput)
    .output(dashboardRecordSchema.nullable())
    .query(({ ctx, input }) =>
      ctx.container.get<IDashboardsService>(DASHBOARDS_SERVICE).get(input.id),
    ),
  create: publicProcedure
    .input(createDashboardInput)
    .output(dashboardRecordSchema)
    .mutation(({ ctx, input }) =>
      ctx.container.get<IDashboardsService>(DASHBOARDS_SERVICE).create(input),
    ),
  update: publicProcedure
    .input(updateDashboardInput)
    .output(dashboardRecordSchema)
    .mutation(({ ctx, input }) =>
      ctx.container.get<IDashboardsService>(DASHBOARDS_SERVICE).update(input),
    ),
  delete: publicProcedure
    .input(dashboardIdInput)
    .mutation(({ ctx, input }) =>
      ctx.container
        .get<IDashboardsService>(DASHBOARDS_SERVICE)
        .delete(input.id),
    ),
  refresh: publicProcedure
    .input(refreshDashboardInput)
    .mutation(({ ctx, input }) =>
      ctx.container.get<IDashboardsService>(DASHBOARDS_SERVICE).refresh(input),
    ),
});
