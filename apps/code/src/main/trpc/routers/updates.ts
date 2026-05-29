import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import {
  checkForUpdatesOutput,
  installUpdateOutput,
  isEnabledOutput,
  UpdatesEvent,
  type UpdatesEvents,
  updatesStatusOutput,
} from "../../services/updates/schemas";
import type { UpdatesService } from "../../services/updates/service";
import { publicProcedure, router } from "../trpc";

const getService = () =>
  container.get<UpdatesService>(MAIN_TOKENS.UpdatesService);

function subscribe<K extends keyof UpdatesEvents>(event: K) {
  return publicProcedure.subscription(async function* (opts) {
    const service = getService();
    const iterable = service.toIterable(event, { signal: opts.signal });
    for await (const data of iterable) {
      yield data;
    }
  });
}

export const updatesRouter = router({
  isEnabled: publicProcedure.output(isEnabledOutput).query(() => {
    const service = getService();
    return { enabled: service.isEnabled };
  }),

  check: publicProcedure.output(checkForUpdatesOutput).mutation(() => {
    const service = getService();
    return service.checkForUpdates();
  }),

  getStatus: publicProcedure.output(updatesStatusOutput).query(() => {
    const service = getService();
    return service.getStatus();
  }),

  install: publicProcedure.output(installUpdateOutput).mutation(() => {
    const service = getService();
    return service.installUpdate();
  }),

  onReady: subscribe(UpdatesEvent.Ready),
  onStatus: subscribe(UpdatesEvent.Status),
  onCheckFromMenu: subscribe(UpdatesEvent.CheckFromMenu),
});
