import {
  ContextGenEvent,
  contextGenerateInput,
  contextThreadInput,
} from "@posthog/core/canvas/contextGenSchemas";
import { CONTEXT_GEN_SERVICE } from "@posthog/core/canvas/identifiers";
import type { IContextGenService } from "@posthog/core/canvas/services";
import { publicProcedure, router } from "@posthog/host-trpc/trpc";

export const contextGenRouter = router({
  generate: publicProcedure
    .input(contextGenerateInput)
    .mutation(({ ctx, input }) =>
      ctx.container
        .get<IContextGenService>(CONTEXT_GEN_SERVICE)
        .generate(input),
    ),
  reset: publicProcedure
    .input(contextThreadInput)
    .mutation(({ ctx, input }) =>
      ctx.container.get<IContextGenService>(CONTEXT_GEN_SERVICE).reset(input),
    ),
  onEvent: publicProcedure
    .input(contextThreadInput)
    .subscription(async function* (opts) {
      const service =
        opts.ctx.container.get<IContextGenService>(CONTEXT_GEN_SERVICE);
      const iterable = service.toIterable(ContextGenEvent.Event, {
        signal: opts.signal,
      });
      for await (const payload of iterable) {
        if (payload.channelId === opts.input.channelId) {
          yield payload.event;
        }
      }
    }),
});
