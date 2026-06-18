import { canvasDataQueryInput } from "@posthog/core/canvas/freeformSchemas";
import { CANVAS_DATA_SERVICE } from "@posthog/core/canvas/identifiers";
import type { ICanvasDataService } from "@posthog/core/canvas/services";
import { publicProcedure, router } from "@posthog/host-trpc/trpc";

// The data avenue behind a freeform canvas's `ph.query` shim. One-line forward
// to CanvasDataService, which injects the PostHog token host-side.
export const canvasDataRouter = router({
  query: publicProcedure
    .input(canvasDataQueryInput)
    .mutation(({ ctx, input }) =>
      ctx.container.get<ICanvasDataService>(CANVAS_DATA_SERVICE).query(input),
    ),
});
