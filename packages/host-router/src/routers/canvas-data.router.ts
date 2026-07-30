import {
  canvasCaptureConfigSchema,
  canvasCaptureInput,
  canvasDataQueryInput,
  canvasLiveConnectionConfigSchema,
  canvasLiveStatsSchema,
  canvasLoadInsightInput,
} from "@posthog/core/canvas/freeformSchemas";
import { CANVAS_DATA_SERVICE } from "@posthog/core/canvas/identifiers";
import type { ICanvasDataService } from "@posthog/core/canvas/services";
import { publicProcedure, router } from "@posthog/host-trpc/trpc";

// The data avenue behind a freeform canvas's `ph.*` shims. One-line forwards to
// CanvasDataService, which injects the PostHog credentials host-side.
export const canvasDataRouter = router({
  query: publicProcedure
    .input(canvasDataQueryInput)
    .mutation(({ ctx, input }) =>
      ctx.container.get<ICanvasDataService>(CANVAS_DATA_SERVICE).query(input),
    ),
  loadInsight: publicProcedure
    .input(canvasLoadInsightInput)
    .mutation(({ ctx, input }) =>
      ctx.container
        .get<ICanvasDataService>(CANVAS_DATA_SERVICE)
        .loadInsight(input),
    ),
  capture: publicProcedure
    .input(canvasCaptureInput)
    .mutation(({ ctx, input }) =>
      ctx.container.get<ICanvasDataService>(CANVAS_DATA_SERVICE).capture(input),
    ),
  captureConfig: publicProcedure
    .output(canvasCaptureConfigSchema)
    .query(({ ctx }) =>
      ctx.container
        .get<ICanvasDataService>(CANVAS_DATA_SERVICE)
        .captureConfig(),
    ),
  // The brokered live-events SSE endpoint + scoped JWT. The renderer holds
  // this in memory only to open `/events` and fan events into the canvas
  // iframe as postMessage frames; the token must never reach the sandbox.
  liveConnectionConfig: publicProcedure
    .output(canvasLiveConnectionConfigSchema)
    .query(({ ctx }) =>
      ctx.container
        .get<ICanvasDataService>(CANVAS_DATA_SERVICE)
        .liveConnectionConfig(),
    ),
  // One-shot realtime counters (users online, active recordings) from the
  // live-events `/stats` endpoint — a poll, distinct from the event stream.
  liveStats: publicProcedure
    .output(canvasLiveStatsSchema)
    .query(({ ctx }) =>
      ctx.container.get<ICanvasDataService>(CANVAS_DATA_SERVICE).liveStats(),
    ),
});
