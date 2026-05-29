import { SITUATIONS, type SituationId } from "@shared/types/workflow";

// O(1) lookup table for situation metadata, built once at module load.
// SITUATIONS itself is an array (ordered for the renderer); this is the map.
export const SITUATION_META: Record<
  SituationId,
  { label: string; description: string }
> = Object.fromEntries(
  SITUATIONS.map((s) => [s.id, { label: s.label, description: s.description }]),
) as Record<SituationId, { label: string; description: string }>;

export const SITUATION_BADGE: Record<
  SituationId,
  "destructive" | "warning" | "success" | "info" | "default"
> = {
  done: "default",
  ready_to_merge: "success",
  ci_failing: "destructive",
  changes_requested: "warning",
  comments_waiting: "warning",
  in_review: "info",
  working: "default",
  stale: "default",
};

export type WorkstreamSeverity = "critical" | "attention" | null;

// Derived from situations rather than a separate field — `ci_failing` is the
// only "critical" today; the user-action-requested situations are "attention".
const CRITICAL: ReadonlySet<SituationId> = new Set(["ci_failing"]);
const ATTENTION: ReadonlySet<SituationId> = new Set([
  "changes_requested",
  "comments_waiting",
]);

export function situationSeverity(
  situations: readonly SituationId[],
): WorkstreamSeverity {
  if (situations.some((s) => CRITICAL.has(s))) return "critical";
  if (situations.some((s) => ATTENTION.has(s))) return "attention";
  return null;
}

export function severityRingClass(severity: WorkstreamSeverity): string {
  if (severity === "critical") return "border-l-2 border-l-(--red-9)";
  if (severity === "attention") return "border-l-2 border-l-(--amber-9)";
  return "";
}
