import type { PrCommentThread } from "@posthog/core/code-review/types";
import type { PrReviewThread } from "@posthog/shared";

export function mapPrCommentThreads(
  threads: PrReviewThread[],
): Map<number, PrCommentThread> {
  return new Map(threads.map((thread) => [thread.rootId, thread]));
}

export function countPrCommentsForFile(
  threads: Map<number, PrCommentThread> | undefined,
  filePath: string,
): number {
  let count = 0;
  for (const thread of threads?.values() ?? []) {
    if (thread.filePath === filePath) count += thread.comments.length;
  }
  return count;
}
