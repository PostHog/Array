import type { HomeWorkstream } from "@posthog/core/home/schemas";
import { SITUATIONS, type SituationId } from "@posthog/core/workflow/schemas";

export type HomeBoardColumn = {
  id: SituationId;
  title: string;
  description: string;
  workstreams: HomeWorkstream[];
};

// Board columns, left → right. `done` (terminal) and `stale` (a modifier, shown
// as a chip) are omitted.
const BOARD_COLUMN_IDS: SituationId[] = [
  "working",
  "in_review",
  "ci_failing",
  "changes_requested",
  "comments_waiting",
  "ready_to_merge",
];

export function columnForWorkstream(
  workstream: HomeWorkstream,
): SituationId | null {
  const primary = workstream.primarySituation;
  if (!primary) return null;
  // Push terminal/done situations off the active board.
  if (primary === "done") return null;
  // `stale` alone (no PR situation) buckets into `working`.
  if (primary === "stale") return "working";
  return primary;
}

export function buildBoardColumns(
  needsAttention: HomeWorkstream[],
  inProgress: HomeWorkstream[],
): HomeBoardColumn[] {
  const map = new Map<SituationId, HomeWorkstream[]>();
  for (const id of BOARD_COLUMN_IDS) map.set(id, []);

  for (const ws of [...needsAttention, ...inProgress]) {
    const id = columnForWorkstream(ws);
    if (!id) continue;
    map.get(id)?.push(ws);
  }

  return BOARD_COLUMN_IDS.map((id) => {
    const meta = SITUATIONS.find((s) => s.id === id);
    return {
      id,
      title: meta?.label ?? id,
      description: meta?.description ?? "",
      workstreams: (map.get(id) ?? []).sort(
        (a, b) => b.lastActivityAt - a.lastActivityAt,
      ),
    };
  });
}
