import { SITUATIONS, type SituationId } from "@shared/types/workflow";
import { pickPrimarySituation } from "@shared/types/workflow-classify";
import type { HomeWorkstream } from "./buildSnapshot";

export type HomeBoardColumn = {
  id: SituationId;
  title: string;
  description: string;
  workstreams: HomeWorkstream[];
};

// Columns shown on the board, left → right. We omit `done` from the active
// view (terminal situations don't need a column — they should fall off) and
// `stale` (it's a modifier, not a workflow stage; it surfaces as a chip).
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
  const primary = pickPrimarySituation(workstream.situations);
  if (!primary) return null;
  // Push terminal/done situations off the active board.
  if (primary === "done") return null;
  // `stale` alone (no PR situation) is still useful to surface — bucket it
  // into `working` since that's where stale-no-PR work belongs visually.
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
