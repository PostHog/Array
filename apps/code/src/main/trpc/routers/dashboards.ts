import { z } from "zod";
import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import {
  createDashboardInput,
  dashboardIdInput,
  dashboardRecordSchema,
  dashboardSummarySchema,
  updateDashboardInput,
} from "../../services/dashboards/schemas";
import type { DashboardsService } from "../../services/dashboards/service";
import { publicProcedure, router } from "../trpc";

const getService = () =>
  container.get<DashboardsService>(MAIN_TOKENS.DashboardsService);

export const dashboardsRouter = router({
  list: publicProcedure
    .output(z.array(dashboardSummarySchema))
    .query(() => getService().list()),
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
});
