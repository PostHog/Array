import {
  FreeformGenEvent,
  freeformGenerateInput,
  freeformThreadInput,
} from "@posthog/core/canvas/freeformSchemas";
import { FREEFORM_GEN_SERVICE } from "@posthog/core/canvas/identifiers";
import type { IFreeformGenService } from "@posthog/core/canvas/services";
import { publicProcedure, router } from "@posthog/host-trpc/trpc";

export const freeformGenRouter = router({
  generate: publicProcedure
    .input(freeformGenerateInput)
    .mutation(({ ctx, input }) =>
      ctx.container
        .get<IFreeformGenService>(FREEFORM_GEN_SERVICE)
        .generate(input),
    ),
  reset: publicProcedure
    .input(freeformThreadInput)
    .mutation(({ ctx, input }) =>
      ctx.container.get<IFreeformGenService>(FREEFORM_GEN_SERVICE).reset(input),
    ),
  onEvent: publicProcedure
    .input(freeformThreadInput)
    .subscription(async function* (opts) {
      const service =
        opts.ctx.container.get<IFreeformGenService>(FREEFORM_GEN_SERVICE);
      const iterable = service.toIterable(FreeformGenEvent.Event, {
        signal: opts.signal,
      });
      for await (const payload of iterable) {
        if (payload.threadId === opts.input.threadId) {
          yield payload.event;
        }
      }
    }),
});
