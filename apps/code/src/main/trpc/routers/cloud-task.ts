import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import {
  CloudTaskEvent,
  onUpdateInput,
  retryInput,
  sendCommandInput,
  sendCommandOutput,
  unwatchInput,
  watchInput,
} from "../../services/cloud-task/schemas";
import type { CloudTaskService } from "../../services/cloud-task/service";
import { publicProcedure, router } from "../trpc";

const getService = () =>
  container.get<CloudTaskService>(MAIN_TOKENS.CloudTaskService);

export const cloudTaskRouter = router({
  watch: publicProcedure
    .input(watchInput)
    .mutation(({ input }) => getService().watch(input)),

  unwatch: publicProcedure
    .input(unwatchInput)
    .mutation(({ input }) => getService().unwatch(input.taskId, input.runId)),

  retry: publicProcedure
    .input(retryInput)
    .mutation(({ input }) => getService().retry(input.taskId, input.runId)),

  sendCommand: publicProcedure
    .input(sendCommandInput)
    .output(sendCommandOutput)
    .mutation(({ input }) => getService().sendCommand(input)),

  onUpdate: publicProcedure
    .input(onUpdateInput)
    .subscription(async function* (opts) {
      const service = getService();
      try {
        for await (const data of service.toIterable(CloudTaskEvent.Update, {
          signal: opts.signal,
        })) {
          if (
            data.taskId === opts.input.taskId &&
            data.runId === opts.input.runId
          ) {
            yield data;
          }
        }
      } finally {
        service.unwatch(opts.input.taskId, opts.input.runId);
      }
    }),
});
