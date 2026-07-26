import type { ThreadRow } from "@posthog/ui/features/sessions/components/new-thread/buildThreadGroups";

export interface ConversationTurn {
  id: string;
  rows: ThreadRow[];
}

function startsConversationTurn(row: ThreadRow): boolean {
  if (row.kind !== "item") return false;
  return (
    row.item.type === "user_message" ||
    row.item.type === "git_action" ||
    row.item.type === "skill_button_action"
  );
}

export function groupRowsIntoTurns(rows: ThreadRow[]): {
  turns: ConversationTurn[];
  rowToTurnIndex: number[];
} {
  const turns: ConversationTurn[] = [];
  const rowToTurnIndex: number[] = [];

  for (const row of rows) {
    if (turns.length === 0 || startsConversationTurn(row)) {
      turns.push({ id: `turn:${row.id}`, rows: [] });
    }
    const turnIndex = turns.length - 1;
    turns[turnIndex].rows.push(row);
    rowToTurnIndex.push(turnIndex);
  }

  return { turns, rowToTurnIndex };
}
