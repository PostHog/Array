import { z } from "zod";

// Canonical PR snapshot the home tab classifies against. This is the wire
// contract: today it's produced locally by the gh-backed PrSnapshotService,
// but the production PostHog backend serialises the *same shape* (see
// docs/workflow-architecture.md §5). Keep it permanent — both ends share it,
// and `classify()` reads a structural subset of these fields.

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

export const prSnapshotArray = z.array(prSnapshot);

// Snapshots are keyed by task, not PR URL: a task's PR may live on its branch
// (resolved server-side / via gh), not just in cloud-run output. Two tasks can
// still point at the same PR — the home tab groups them by the snapshot's url.

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
export type GetPrSnapshotsInput = z.infer<typeof getPrSnapshotsInput>;

export const refreshPrSnapshotsInput = z
  .object({ tasks: z.array(taskPrRef).optional() })
  .strict();
export type RefreshPrSnapshotsInput = z.infer<typeof refreshPrSnapshotsInput>;

// Events ----------------------------------------------------------------------

export const PrSnapshotEvent = {
  // Emitted with only the task snapshots that materially changed since last refresh.
  Updated: "updated",
} as const;

export interface PrSnapshotEvents {
  [PrSnapshotEvent.Updated]: TaskPrSnapshot[];
}
