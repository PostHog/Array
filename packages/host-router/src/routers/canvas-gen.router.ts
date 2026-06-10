import {
  CanvasGenEvent,
  canvasGenerateInput,
  canvasThreadInput,
} from "@posthog/core/canvas/genSchemas";
import { CANVAS_GEN_SERVICE } from "@posthog/core/canvas/identifiers";
import type { ICanvasGenService } from "@posthog/core/canvas/services";
import { publicProcedure, router } from "@posthog/host-trpc/trpc";

export const canvasGenRouter = router({
  generate: publicProcedure
    .input(canvasGenerateInput)
    .mutation(({ ctx, input }) =>
      ctx.container.get<ICanvasGenService>(CANVAS_GEN_SERVICE).generate(input),
    ),
  reset: publicProcedure
    .input(canvasThreadInput)
    .mutation(({ ctx, input }) =>
      ctx.container.get<ICanvasGenService>(CANVAS_GEN_SERVICE).reset(input),
    ),
  onEvent: publicProcedure
    .input(canvasThreadInput)
    .subscription(async function* (opts) {
      const service =
        opts.ctx.container.get<ICanvasGenService>(CANVAS_GEN_SERVICE);
      const iterable = service.toIterable(CanvasGenEvent.Event, {
        signal: opts.signal,
      });
      for await (const payload of iterable) {
        if (payload.threadId === opts.input.threadId) {
          yield payload.event;
        }
      }
    }),
});
