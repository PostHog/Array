import {
  getPrSnapshotsInput,
  PrSnapshotEvent,
  type PrSnapshotEvents,
  refreshPrSnapshotsInput,
  taskPrSnapshotArray,
} from "@shared/types/pr-snapshot";
import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import type { PrSnapshotService } from "../../services/pr-snapshot/service";
import { publicProcedure, router } from "../trpc";

const getService = () =>
  container.get<PrSnapshotService>(MAIN_TOKENS.PrSnapshotService);

function subscribe<K extends keyof PrSnapshotEvents>(event: K) {
  return publicProcedure.subscription(async function* (opts) {
    const service = getService();
    const iterable = service.toIterable(event, { signal: opts.signal });
    for await (const data of iterable) {
      yield data;
    }
  });
}

export const prSnapshotRouter = router({
  getSnapshots: publicProcedure
    .input(getPrSnapshotsInput)
    .output(taskPrSnapshotArray)
    .query(({ input }) => getService().getSnapshots(input.tasks)),
  refresh: publicProcedure
    .input(refreshPrSnapshotsInput)
    .mutation(({ input }) => getService().refresh(input.tasks)),
  onUpdated: subscribe(PrSnapshotEvent.Updated),
});
