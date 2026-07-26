import {
  CANVAS_APPLICATION_API,
  type CanvasApplicationApi,
} from "@posthog/core/canvas/canvasApplicationApi";
import { publicProcedure, router } from "@posthog/host-trpc/trpc";
import {
  canvasApplicationBuildInputSchema,
  canvasApplicationIdInputSchema,
  canvasApplicationPublishInputSchema,
  canvasHistorySchema,
  canvasPersistedBuildSchema,
  canvasPublishResultSchema,
  canvasSourceSnapshotSchema,
} from "@posthog/shared/canvas-application";

export const canvasApplicationRouter = router({
  getCurrentSource: publicProcedure
    .input(canvasApplicationIdInputSchema)
    .output(canvasSourceSnapshotSchema.nullable())
    .query(({ ctx, input }) =>
      ctx.container
        .get<CanvasApplicationApi>(CANVAS_APPLICATION_API)
        .getCurrentSource(input.canvasId),
    ),
  publish: publicProcedure
    .input(canvasApplicationPublishInputSchema)
    .output(canvasPublishResultSchema)
    .mutation(({ ctx, input }) => {
      const { canvasId, ...request } = input;
      return ctx.container
        .get<CanvasApplicationApi>(CANVAS_APPLICATION_API)
        .publish(canvasId, request);
    }),
  history: publicProcedure
    .input(canvasApplicationIdInputSchema)
    .output(canvasHistorySchema)
    .query(({ ctx, input }) =>
      ctx.container
        .get<CanvasApplicationApi>(CANVAS_APPLICATION_API)
        .history(input.canvasId),
    ),
  getBuild: publicProcedure
    .input(canvasApplicationBuildInputSchema)
    .output(canvasPersistedBuildSchema)
    .query(({ ctx, input }) =>
      ctx.container
        .get<CanvasApplicationApi>(CANVAS_APPLICATION_API)
        .getBuild(input.canvasId, input.buildId),
    ),
});
