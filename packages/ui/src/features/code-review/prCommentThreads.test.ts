import type { PrReviewThread } from "@posthog/shared";
import { describe, expect, it } from "vitest";
import {
  countPrCommentsForFile,
  mapPrCommentThreads,
} from "./prCommentThreads";

function makeThread(
  rootId: number,
  filePath: string,
  commentCount: number,
): PrReviewThread {
  return {
    rootId,
    nodeId: `thread-${rootId}`,
    isResolved: false,
    filePath,
    comments: Array.from({ length: commentCount }, (_, index) => ({
      id: rootId * 100 + index,
      body: "comment",
      path: filePath,
      line: 1,
      original_line: 1,
      side: "RIGHT" as const,
      start_line: null,
      start_side: null,
      diff_hunk: "@@ -1 +1 @@",
      in_reply_to_id: null,
      user: { login: "reviewer", avatar_url: "" },
      created_at: "2026-07-14T00:00:00Z",
      updated_at: "2026-07-14T00:00:00Z",
      subject_type: "line" as const,
    })),
  };
}

describe("PR comment thread helpers", () => {
  it("maps threads by root id", () => {
    const threads = [
      makeThread(1, "src/one.ts", 1),
      makeThread(2, "src/two.ts", 1),
    ];

    expect([...mapPrCommentThreads(threads).keys()]).toEqual([1, 2]);
  });

  it.each([
    ["src/one.ts", 3],
    ["src/two.ts", 4],
    ["src/missing.ts", 0],
  ])("counts all comments and replies for %s", (filePath, expected) => {
    const threads = mapPrCommentThreads([
      makeThread(1, "src/one.ts", 2),
      makeThread(2, "src/one.ts", 1),
      makeThread(3, "src/two.ts", 4),
    ]);

    expect(countPrCommentsForFile(threads, filePath)).toBe(expected);
  });
});
