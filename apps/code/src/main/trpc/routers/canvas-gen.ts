import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import {
  CanvasGenEvent,
  canvasGenerateInput,
  canvasThreadInput,
} from "../../services/canvas-gen/schemas";
import type { CanvasGenService } from "../../services/canvas-gen/service";
import { publicProcedure, router } from "../trpc";

const getService = () =>
  container.get<CanvasGenService>(MAIN_TOKENS.CanvasGenService);

export const canvasGenRouter = router({
  generate: publicProcedure
    .input(canvasGenerateInput)
    .mutation(({ input }) => getService().generate(input)),
  reset: publicProcedure
    .input(canvasThreadInput)
    .mutation(({ input }) => getService().reset(input)),
  onEvent: publicProcedure
    .input(canvasThreadInput)
    .subscription(async function* (opts) {
      const service = getService();
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
