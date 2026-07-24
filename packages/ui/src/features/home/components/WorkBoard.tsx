import type { Icon } from "@phosphor-icons/react";
import {
  type SituationColor,
  situationCss,
} from "@posthog/ui/features/home/utils/situationDisplay";
import { ScrollArea } from "@radix-ui/themes";
import type { ReactNode } from "react";

export interface WorkBoardColumn<T> {
  id: string;
  label: string;
  description: string;
  color: SituationColor;
  Icon: Icon;
  items: T[];
}

export function WorkBoard<T>({
  columns,
  getKey,
  renderCard,
  isLoading = false,
}: {
  columns: WorkBoardColumn<T>[];
  getKey: (item: T) => string;
  renderCard: (item: T) => ReactNode;
  isLoading?: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 gap-3 overflow-x-auto p-4">
      {columns.map((column) => {
        const c = situationCss(column.color);
        const count = column.items.length;
        return (
          <div
            key={column.id}
            className="flex h-full min-h-0 w-[300px] shrink-0 flex-col"
          >
            <div
              className="mb-2 flex items-center gap-2 px-1"
              title={column.description}
            >
              <span style={{ color: c.fg }}>
                <column.Icon size={14} weight="bold" />
              </span>
              <span className="font-semibold text-[12px] text-gray-12">
                {column.label}
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
              <ScrollArea scrollbars="vertical" className="h-full min-h-0">
                <div className="flex flex-col gap-2 p-2">
                  {count === 0 && !isLoading ? (
                    <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-(--gray-a5) border-dashed py-10">
                      <column.Icon size={18} className="text-(--gray-8)" />
                      <span className="text-(--gray-9) text-[11px]">
                        Nothing here
                      </span>
                    </div>
                  ) : count > 0 ? (
                    column.items.map((item) => (
                      <div key={getKey(item)}>{renderCard(item)}</div>
                    ))
                  ) : null}
                  {isLoading ? <WorkBoardCardSkeleton /> : null}
                </div>
              </ScrollArea>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WorkBoardCardSkeleton() {
  return (
    <output
      aria-label="Loading tasks"
      className="flex h-[112px] animate-pulse flex-col gap-3 rounded-lg border border-(--gray-4) bg-(--color-panel-solid) p-3"
    >
      <div className="h-3 w-4/5 rounded bg-(--gray-5)" />
      <div className="h-3 w-2/5 rounded bg-(--gray-4)" />
      <div className="mt-auto flex items-center justify-between">
        <div className="h-5 w-20 rounded bg-(--gray-4)" />
        <div className="h-3 w-12 rounded bg-(--gray-4)" />
      </div>
    </output>
  );
}
