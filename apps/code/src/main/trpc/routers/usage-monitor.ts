import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import {
  UsageMonitorEvent,
  type UsageMonitorEvents,
  usageSnapshotOutput,
} from "../../services/usage-monitor/schemas";
import type { UsageMonitorService } from "../../services/usage-monitor/service";
import { publicProcedure, router } from "../trpc";

const getService = () =>
  container.get<UsageMonitorService>(MAIN_TOKENS.UsageMonitorService);

function subscribe<K extends keyof UsageMonitorEvents>(event: K) {
  return publicProcedure.subscription(async function* (opts) {
    const service = getService();
    const iterable = service.toIterable(event, { signal: opts.signal });
    for await (const data of iterable) {
      yield data;
    }
  });
}

export const usageMonitorRouter = router({
  onThresholdCrossed: subscribe(UsageMonitorEvent.ThresholdCrossed),
  // Stream of full usage snapshots — replaces the renderer's 30s poll.
  onUsageUpdated: subscribe(UsageMonitorEvent.UsageUpdated),
  // Cached snapshot for the renderer to bootstrap before the first event
  // arrives. Null until the first poll completes.
  getLatest: publicProcedure
    .output(usageSnapshotOutput)
    .query(() => getService().getLatest()),
  refresh: publicProcedure
    .output(usageSnapshotOutput)
    .mutation(() => getService().refreshNow()),
});
