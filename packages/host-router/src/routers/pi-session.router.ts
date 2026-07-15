import { publicProcedure, router } from "@posthog/host-trpc/trpc";
import { PI_SESSION_SERVICE } from "@posthog/workspace-server/services/pi-session/identifiers";
import type { PiSessionService } from "@posthog/workspace-server/services/pi-session/pi-session";
import {
  piSessionEntriesInput,
  piSessionPromptInput,
  piSessionStartOutput,
  piSessionTranscriptInput,
  resumePiSessionInput,
  startPiSessionInput,
} from "@posthog/workspace-server/services/pi-session/schemas";

const getService = (container: { get<T>(token: symbol): T }) =>
  container.get<PiSessionService>(PI_SESSION_SERVICE);

export const piSessionRouter = router({
  start: publicProcedure
    .input(startPiSessionInput)
    .output(piSessionStartOutput)
    .mutation(({ ctx, input }) => getService(ctx.container).start(input)),

  resume: publicProcedure
    .input(resumePiSessionInput)
    .mutation(({ ctx, input }) => getService(ctx.container).resume(input)),

  prompt: publicProcedure
    .input(piSessionPromptInput)
    .mutation(({ ctx, input }) =>
      getService(ctx.container).prompt(input.taskId, input.prompt),
    ),

  abort: publicProcedure
    .input(piSessionTranscriptInput)
    .mutation(({ ctx, input }) =>
      getService(ctx.container).abort(input.taskId),
    ),

  stop: publicProcedure
    .input(piSessionTranscriptInput)
    .mutation(({ ctx, input }) => getService(ctx.container).stop(input.taskId)),

  status: publicProcedure
    .input(piSessionTranscriptInput)
    .query(({ ctx, input }) => getService(ctx.container).status(input.taskId)),

  entries: publicProcedure
    .input(piSessionEntriesInput)
    .query(({ ctx, input }) =>
      getService(ctx.container).entries(input.taskId, input.since),
    ),

  onEvent: publicProcedure
    .input(piSessionTranscriptInput)
    .subscription(async function* (opts) {
      const service = getService(opts.ctx.container);
      const iterable = service.toIterable("event", { signal: opts.signal });
      for await (const payload of iterable) {
        if (payload.taskId === opts.input.taskId) {
          yield payload.event;
        }
      }
    }),
});
