import { z } from "zod";

// Canonical PR snapshot the home tab classifies against. Produced server-side
// by PostHog and embedded in each workstream of the home snapshot
// (docs/workflow-architecture.md §5).

export const prSnapshotState = z.enum(["open", "draft", "merged", "closed"]);
export type PrSnapshotState = z.infer<typeof prSnapshotState>;

export const prCiStatus = z.enum(["passing", "failing", "pending", "none"]);
export type PrCiStatus = z.infer<typeof prCiStatus>;

export const prReviewDecision = z.enum([
  "approved",
  "changes_requested",
  "review_required",
]);
export type PrReviewDecision = z.infer<typeof prReviewDecision>;

export const prSnapshot = z
  .object({
    url: z.string(),
    number: z.number().int().nonnegative(),
    title: z.string(),
    state: prSnapshotState,
    ciStatus: prCiStatus,
    reviewDecision: prReviewDecision.nullable(),
    unresolvedThreads: z.number().int().nonnegative(),
    /** GitHub mergeability: true / false / null when unknown. */
    mergeable: z.boolean().nullable(),
    isCurrentUserRequestedReviewer: z.boolean(),
    isCurrentUserAuthor: z.boolean(),
    author: z.string().nullable(),
    /** Epoch ms of the PR's last update on GitHub. */
    lastUpdatedAt: z.number(),
  })
  .strict();
export type PrSnapshot = z.infer<typeof prSnapshot>;
