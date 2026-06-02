import { z } from "zod";

// Canonical PR snapshot the home tab classifies against, and the wire contract:
// produced locally by the gh-backed PrSnapshotService today; the production
// PostHog backend serialises the same shape (docs/workflow-architecture.md §5).

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

// Keyed by task, not PR URL: a task's PR may live on its branch, not just in
// cloud-run output. Two tasks can point at the same PR — home groups them by url.

/** What the client knows about a task before resolution: its id + any cloud PR URL. */
export const taskPrRef = z
  .object({ taskId: z.string(), cloudPrUrl: z.string().nullable() })
  .strict();
export type TaskPrRef = z.infer<typeof taskPrRef>;

/** A resolved snapshot tagged with the task it was resolved for. */
export const taskPrSnapshot = z
  .object({ taskId: z.string(), snapshot: prSnapshot })
  .strict();
export type TaskPrSnapshot = z.infer<typeof taskPrSnapshot>;

export const taskPrSnapshotArray = z.array(taskPrSnapshot);

// tRPC io ---------------------------------------------------------------------

export const getPrSnapshotsInput = z
  .object({ tasks: z.array(taskPrRef) })
  .strict();

export const refreshPrSnapshotsInput = z
  .object({ tasks: z.array(taskPrRef).optional() })
  .strict();

// Events ----------------------------------------------------------------------

export const PrSnapshotEvent = {
  // Emitted with only the task snapshots that materially changed since last refresh.
  Updated: "updated",
} as const;

export interface PrSnapshotEvents {
  [PrSnapshotEvent.Updated]: TaskPrSnapshot[];
}
