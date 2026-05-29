import type { SituationId } from "@shared/types/workflow";

// Inputs the classifier needs to decide which situations a piece of work
// is in. All optional / nullable so the same function works whether we
// have rich GitHub data, just a local git state, or only task metadata.
export interface ClassifyInput {
  /** True if any task on the workstream points at a PR URL. */
  hasPrUrl: boolean;
  /** PR snapshot (when available — null until a GitHub fetcher is wired up). */
  pr: {
    state: "open" | "draft" | "merged" | "closed";
    ciStatus: "passing" | "failing" | "pending" | "none";
    reviewDecision: "approved" | "changes_requested" | "review_required" | null;
    unresolvedThreads: number;
    isCurrentUserAuthor: boolean;
    mergeable?: boolean | null;
  } | null;
  /** Local git ahead/behind, when we have a worktree to inspect. */
  gitState?: {
    commitsAhead: number;
    commitsBehind?: number;
    dirty?: boolean;
  } | null;
  /** Branch the workstream is on (used as a working signal when no PR yet). */
  branch: string | null;
  /** Epoch ms of the freshest activity across all tasks in the workstream. */
  lastActivityAt: number;
  /** Now — passed in so unit tests can pin time. */
  now: number;
}

// Tunable; surfaced here so a future settings UI can expose it.
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Pure classifier — takes a single workstream's observed state and emits
 * the (possibly multiple) situations it's in. Deliberately defensive: if
 * a signal is missing, the situation that depended on it simply doesn't
 * fire, rather than producing a misleading bucket.
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
    // `in_review` is the catch-all for any PR that's open/draft without a
    // more-specific situation. We still emit it alongside ci_failing etc. so
    // the list view can surface the workstream under "In review" too — the
    // board uses primary-situation priority to decide column placement.
    if (pr.state === "open" || pr.state === "draft") {
      out.add("in_review");
    }
  } else if (hasPrUrl) {
    // Workstream has a PR URL stamped on a task but we don't have PR data
    // yet (the GitHub fetcher isn't wired up). Treat it as in review so it
    // doesn't fall into `working`.
    out.add("in_review");
  } else if (branch) {
    // No PR yet — branch with local changes.
    const ahead = gitState?.commitsAhead;
    if (ahead === undefined || ahead > 0) out.add("working");
  }

  // `stale` stacks on top of whatever else applies, except `done` (handled
  // above with an early return).
  if (now - lastActivityAt > STALE_THRESHOLD_MS) {
    out.add("stale");
  }

  return out;
}

// Priority order for picking the *primary* situation when a workstream is in
// several at once. Used by the board to decide column placement; the list
// view can show the workstream in every section it qualifies for.
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
