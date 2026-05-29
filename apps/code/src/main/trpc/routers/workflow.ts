import {
  saveInput,
  saveResult,
  WorkflowEvent,
  type WorkflowEvents,
  workflowConfig,
} from "@shared/types/workflow";
import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import type { WorkflowService } from "../../services/workflow/service";
import { publicProcedure, router } from "../trpc";

const getService = () =>
  container.get<WorkflowService>(MAIN_TOKENS.WorkflowService);

function subscribe<K extends keyof WorkflowEvents>(event: K) {
  return publicProcedure.subscription(async function* (opts) {
    const service = getService();
    const iterable = service.toIterable(event, { signal: opts.signal });
    for await (const data of iterable) {
      yield data;
    }
  });
}

export const workflowRouter = router({
  get: publicProcedure.output(workflowConfig).query(() => getService().get()),
  save: publicProcedure
    .input(saveInput)
    .output(saveResult)
    .mutation(({ input }) => getService().save(input)),
  resetToDefault: publicProcedure
    .output(workflowConfig)
    .mutation(() => getService().resetToDefault()),
  onChanged: subscribe(WorkflowEvent.Changed),
});
