import { z } from "zod";
import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import {
  createDashboardInput,
  dashboardIdInput,
  dashboardRecordSchema,
  dashboardSummarySchema,
  listDashboardsInput,
  updateDashboardInput,
} from "../../services/dashboards/schemas";
import type { DashboardsService } from "../../services/dashboards/service";
import { publicProcedure, router } from "../trpc";

const getService = () =>
  container.get<DashboardsService>(MAIN_TOKENS.DashboardsService);

export const dashboardsRouter = router({
  list: publicProcedure
    .input(listDashboardsInput)
    .output(z.array(dashboardSummarySchema))
    .query(({ input }) => getService().list(input.channelId)),
  get: publicProcedure
    .input(dashboardIdInput)
    .output(dashboardRecordSchema.nullable())
    .query(({ input }) => getService().get(input.id)),
  create: publicProcedure
    .input(createDashboardInput)
    .output(dashboardRecordSchema)
    .mutation(({ input }) => getService().create(input)),
  update: publicProcedure
    .input(updateDashboardInput)
    .output(dashboardRecordSchema)
    .mutation(({ input }) => getService().update(input)),
  delete: publicProcedure
    .input(dashboardIdInput)
    .mutation(({ input }) => getService().delete(input.id)),
  adoptOrphans: publicProcedure
    .input(listDashboardsInput)
    .output(z.number())
    .mutation(({ input }) => getService().adoptOrphans(input.channelId)),
});
