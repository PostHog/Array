import type { SituationId } from "@shared/types/workflow";

// Inputs the classifier reads. All optional/nullable so it works with rich
// GitHub data, just local git state, or only task metadata.
export interface ClassifyInput {
  hasPrUrl: boolean;
  pr: {
    state: "open" | "draft" | "merged" | "closed";
    ciStatus: "passing" | "failing" | "pending" | "none";
    reviewDecision: "approved" | "changes_requested" | "review_required" | null;
    unresolvedThreads: number;
    isCurrentUserAuthor: boolean;
    mergeable?: boolean | null;
  } | null;
  gitState?: {
    commitsAhead: number;
    commitsBehind?: number;
    dirty?: boolean;
  } | null;
  /** Working signal when there's no PR yet. */
  branch: string | null;
  /** Epoch ms, freshest across the workstream's tasks. */
  lastActivityAt: number;
  /** Passed in so tests can pin time. */
  now: number;
}

// Tunable; surfaced here so a future settings UI can expose it.
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Pure classifier: emits the (possibly several) situations a workstream is in.
 * Defensive — a missing signal just means its situation doesn't fire.
 */
export function classify(input: ClassifyInput): Set<SituationId> {
  const out = new Set<SituationId>();
  const { pr, hasPrUrl, gitState, branch, lastActivityAt, now } = input;

  if (pr) {
    if (pr.state === "merged" || pr.state === "closed") {
      out.add("done");
      // `done` is exclusive — return early so we don't double-bucket merged PRs.
      return out;
    }

    if (pr.ciStatus === "failing") out.add("ci_failing");
    if (pr.reviewDecision === "changes_requested") out.add("changes_requested");
    if (pr.unresolvedThreads > 0 && pr.isCurrentUserAuthor) {
      out.add("comments_waiting");
    }
    if (
      pr.state === "open" &&
      pr.ciStatus === "passing" &&
      pr.reviewDecision === "approved" &&
      pr.mergeable !== false
    ) {
      out.add("ready_to_merge");
    }
    // Catch-all for an open/draft PR. Emitted alongside ci_failing etc. so the
    // list view can show it under "In review"; the board uses primary-situation
    // priority for column placement.
    if (pr.state === "open" || pr.state === "draft") {
      out.add("in_review");
    }
  } else if (hasPrUrl) {
    // PR URL stamped on a task but no PR data yet — treat as in review so it
    // doesn't fall into `working`.
    out.add("in_review");
  } else if (branch) {
    // No PR yet — branch with local changes.
    const ahead = gitState?.commitsAhead;
    if (ahead === undefined || ahead > 0) out.add("working");
  }

  // `stale` stacks on top of anything except `done` (early-returned above).
  if (now - lastActivityAt > STALE_THRESHOLD_MS) {
    out.add("stale");
  }

  return out;
}

// Priority for picking the *primary* situation when several apply — drives
// board column placement.
export const SITUATION_PRIORITY: SituationId[] = [
  "done",
  "ready_to_merge",
  "ci_failing",
  "changes_requested",
  "comments_waiting",
  "in_review",
  "working",
  "stale",
];

export function pickPrimarySituation(
  situations: ReadonlySet<SituationId> | readonly SituationId[],
): SituationId | null {
  const set = situations instanceof Set ? situations : new Set(situations);
  for (const sid of SITUATION_PRIORITY) {
    if (set.has(sid)) return sid;
  }
  return null;
}
