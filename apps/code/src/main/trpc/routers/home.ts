import {
  HomeEvent,
  type HomeEvents,
  homeSnapshot,
} from "@shared/types/home-snapshot";
import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import type { HomeService } from "../../services/home/service";
import { publicProcedure, router } from "../trpc";

const getService = () => container.get<HomeService>(MAIN_TOKENS.HomeService);

function subscribe<K extends keyof HomeEvents>(event: K) {
  return publicProcedure.subscription(async function* (opts) {
    const service = getService();
    const iterable = service.toIterable(event, { signal: opts.signal });
    for await (const data of iterable) {
      yield data;
    }
  });
}

export const homeRouter = router({
  getSnapshot: publicProcedure
    .output(homeSnapshot)
    .query(() => getService().getSnapshot()),
  refresh: publicProcedure
    .output(homeSnapshot)
    .mutation(() => getService().refresh()),
  onSnapshotUpdated: subscribe(HomeEvent.SnapshotUpdated),
});
