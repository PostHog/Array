import type { SituationId } from "@shared/types/workflow";

// Situation classification itself runs server-side in PostHog's
// `evaluate-code-workstreams` Temporal worker; the snapshot arrives with each
// workstream's situations already computed. What lives here is pure renderer
// presentation logic over that set: picking the one situation to highlight.

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
