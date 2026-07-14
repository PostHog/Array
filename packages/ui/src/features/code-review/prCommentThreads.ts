import type { PrCommentThread } from "@posthog/core/code-review/types";
import type { PrReviewThread } from "@posthog/shared";
import type { ChangedFile } from "@posthog/shared/domain-types";

export function mapPrCommentThreads(
  threads: PrReviewThread[],
): Map<number, PrCommentThread> {
  return new Map(threads.map((thread) => [thread.rootId, thread]));
}

export function countPrCommentsForFile(
  threads: Map<number, PrCommentThread> | undefined,
  file: Pick<ChangedFile, "path" | "originalPath">,
): number {
  let count = 0;
  for (const thread of threads?.values() ?? []) {
    if (
      thread.filePath === file.path ||
      (file.originalPath != null && thread.filePath === file.originalPath)
    ) {
      count += thread.comments.length;
    }
  }
  return count;
}
