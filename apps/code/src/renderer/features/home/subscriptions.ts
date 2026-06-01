import { trpc, trpcClient } from "@renderer/trpc";
import { logger } from "@utils/logger";
import { queryClient } from "@utils/queryClient";
import { usePrSnapshotStore } from "./stores/prSnapshotStore";

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

  const prSnapshotUpdated = trpcClient.prSnapshot.onUpdated.subscribe(
    undefined,
    {
      onData: (snapshots) => {
        usePrSnapshotStore.getState().upsertMany(snapshots);
      },
      onError: (error) => {
        log.error("prSnapshot.onUpdated subscription error", { error });
      },
    },
  );

  return () => {
    workflowChanged.unsubscribe();
    prSnapshotUpdated.unsubscribe();
  };
}
