import type { HomeSnapshot } from "@posthog/core/home/schemas";
import type { SituationId } from "@posthog/core/workflow/schemas";
import {
  buildBoardColumns,
  type HomeBoardColumn,
} from "@posthog/ui/features/home/utils/boardColumns";
import {
  SITUATION_VISUAL,
  situationCss,
} from "@posthog/ui/features/home/utils/situationDisplay";
import { ScrollArea } from "@radix-ui/themes";
import { useMemo } from "react";
import { HomeWorkstreamCard } from "./HomeWorkstreamCard";

interface HomeBoardViewProps {
  snapshot: HomeSnapshot;
}

export function HomeBoardView({ snapshot }: HomeBoardViewProps) {
  const columns = useMemo(
    () => buildBoardColumns(snapshot.needsAttention, snapshot.inProgress),
    [snapshot.needsAttention, snapshot.inProgress],
  );

  return (
    <ScrollArea scrollbars="horizontal">
      <div className="flex h-full min-h-0 gap-3 p-4">
        {columns.map((column) => (
          <BoardColumn key={column.id} column={column} />
        ))}
      </div>
    </ScrollArea>
  );
}

function BoardColumn({ column }: { column: HomeBoardColumn }) {
  const v = SITUATION_VISUAL[column.id];
  const c = situationCss(v.color);
  const Icon = v.Icon;
  const count = column.workstreams.length;

  return (
    <div className="flex h-full min-h-0 w-[300px] shrink-0 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1" title={v.description}>
        <span style={{ color: c.fg }}>
          <Icon size={14} weight="bold" />
        </span>
        <span className="font-semibold text-[12px] text-gray-12">
          {v.label}
        </span>
        <span
          className="rounded-full px-1.5 py-px font-semibold text-[10.5px] tabular-nums"
          style={{ color: c.fg, backgroundColor: c.tint }}
        >
          {count}
        </span>
      </div>

      <div
        className="min-h-0 flex-1 rounded-xl border border-(--gray-3)"
        style={{ backgroundColor: c.wash }}
      >
        <ScrollArea scrollbars="vertical">
          <div className="flex flex-col gap-2 p-2">
            {count === 0 ? (
              <EmptyColumn sid={column.id} />
            ) : (
              column.workstreams.map((ws) => (
                <HomeWorkstreamCard key={ws.id} workstream={ws} />
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function EmptyColumn({ sid }: { sid: SituationId }) {
  const v = SITUATION_VISUAL[sid];
  const Icon = v.Icon;
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-(--gray-a5) border-dashed py-10">
      <Icon size={18} className="text-(--gray-8)" />
      <span className="text-(--gray-9) text-[11px]">Nothing here</span>
    </div>
  );
}
