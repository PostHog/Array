import { MenuLabel } from "@posthog/quill";
import {
  TASK_ICON_SPEC_GROUPS,
  type TaskIconSpec,
} from "@posthog/ui/features/design-system/taskIconSpecs";
import type { ReactNode } from "react";

/**
 * A preview column dressed as the real thing: a bordered nav panel with a
 * title, its own scroll, and sidebar section labels between the state groups.
 * Judging a row treatment in a bare table lies about the two things that
 * actually decide it — how it reads at nav width, and how it reads stacked
 * against twenty neighbours.
 */
export function TaskNavColumn({
  title,
  subtitle,
  renderRow,
}: {
  title: string;
  subtitle: string;
  renderRow: (spec: TaskIconSpec) => ReactNode;
}) {
  return (
    <div
      data-testid="design-system-column"
      className="flex h-full w-[330px] shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-background"
    >
      <div className="flex shrink-0 flex-col gap-0.5 border-(--gray-5) border-b px-3 py-2.5">
        <span className="font-semibold text-[13px] text-gray-12">{title}</span>
        <span className="text-[11px] text-muted-foreground leading-snug">
          {subtitle}
        </span>
      </div>
      {/* A plain overflow container, like the real space sidebar — Radix's
          ScrollArea sizes its viewport child to max-content, which stops rows
          from shrinking and pushes the trailing content out of sight. */}
      <div className="scroll-mask-4 min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="flex flex-col py-1.5">
          {TASK_ICON_SPEC_GROUPS.map((group) => (
            <div key={group.label} className="flex flex-col">
              <MenuLabel className="px-3 pt-2.5 pb-1 text-muted-foreground/50">
                {group.label}
              </MenuLabel>
              {group.specs.map((spec) => (
                <div key={spec.id}>{renderRow(spec)}</div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
