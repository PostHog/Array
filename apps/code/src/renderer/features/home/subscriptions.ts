import { trpc, trpcClient } from "@renderer/trpc";
import { logger } from "@utils/logger";
import { queryClient } from "@utils/queryClient";

const log = logger.scope("home-subscriptions");

export function registerHomeSubscriptions() {
  const workflowChanged = trpcClient.workflow.onChanged.subscribe(undefined, {
    onData: (next) => {
      queryClient.setQueryData(trpc.workflow.get.queryKey(), next);
    },
    onError: (error) => {
      log.error("workflow.onChanged subscription error", { error });
    },
  });

  return () => {
    workflowChanged.unsubscribe();
  };
}
