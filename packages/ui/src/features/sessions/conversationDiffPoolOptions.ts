import type { DiffWorkerFactory } from "@posthog/ui/shell/diffWorkerHost";

export function createConversationDiffPoolOptions(
  diffWorkerFactory: DiffWorkerFactory,
) {
  return {
    workerFactory: () => diffWorkerFactory(),
    totalASTLRUCacheSize: 200,
    poolSize: 2,
  };
}
