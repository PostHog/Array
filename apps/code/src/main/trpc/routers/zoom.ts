import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import {
  setZoomLevelInputSchema,
  ZoomServiceEvent,
  zoomStateSchema,
} from "../../services/zoom/schemas";
import type { ZoomService } from "../../services/zoom/service";
import { publicProcedure, router } from "../trpc";

const getService = () => container.get<ZoomService>(MAIN_TOKENS.ZoomService);

export const zoomRouter = router({
  getState: publicProcedure
    .output(zoomStateSchema)
    .query(() => getService().getState()),
  zoomIn: publicProcedure
    .output(zoomStateSchema)
    .mutation(() => getService().zoomIn()),
  zoomOut: publicProcedure
    .output(zoomStateSchema)
    .mutation(() => getService().zoomOut()),
  reset: publicProcedure
    .output(zoomStateSchema)
    .mutation(() => getService().reset()),
  setLevel: publicProcedure
    .input(setZoomLevelInputSchema)
    .output(zoomStateSchema)
    .mutation(({ input }) => getService().setLevel(input.level)),
  onChange: publicProcedure.subscription(async function* (opts) {
    const service = getService();
    // Emit the current state immediately so subscribers render the right value.
    yield service.getState();
    const iterable = service.toIterable(ZoomServiceEvent.Changed, {
      signal: opts.signal,
    });
    for await (const data of iterable) {
      yield data;
    }
  }),
});
