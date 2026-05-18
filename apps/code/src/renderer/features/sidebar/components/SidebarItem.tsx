import { Tooltip } from "@components/ui/Tooltip";
import { Button, cn } from "@posthog/quill";
import { useRef, useState } from "react";
import type { SidebarItemAction } from "../types";

const INDENT_SIZE = 8;

interface SidebarItemProps {
  depth: number;
  icon?: React.ReactNode;
  label: React.ReactNode;
  subtitle?: React.ReactNode;
  isActive?: boolean;
  isDimmed?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  action?: SidebarItemAction;
  endContent?: React.ReactNode;
  disabled?: boolean;
}

/**
 * Label that truncates with an ellipsis and reveals the full text in a
 * tooltip on hover when it's actually clipped. Truncation is scoped to this
 * span so sibling content (e.g. `endContent`) is never hidden.
 */
function SidebarItemLabel({ label }: { label: React.ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const canTooltip = typeof label === "string" || typeof label === "number";

  const span = (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover handlers only drive a tooltip for truncated labels
    <span
      ref={ref}
      className="min-w-0 flex-1 truncate"
      onMouseEnter={() => {
        const el = ref.current;
        if (canTooltip && el && el.scrollWidth > el.clientWidth) {
          setShowTooltip(true);
        }
      }}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {label}
    </span>
  );

  if (!canTooltip) return span;

  return (
    <Tooltip content={label} open={showTooltip} side="top">
      {span}
    </Tooltip>
  );
}

export function SidebarItem({
  depth,
  icon,
  label,
  subtitle,
  isActive,
  draggable,
  onDragStart,
  onClick,
  onDoubleClick,
  onContextMenu,
  endContent,
  disabled,
}: SidebarItemProps) {
  return (
    <Button
      type="button"
      className={cn(
        "group flex w-full cursor-default text-left text-[13px] leading-snug transition-colors",
        "focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent-8",
        "disabled:opacity-100 data-active:bg-fill-selected",
      )}
      data-active={isActive || undefined}
      draggable={draggable}
      onDragStart={onDragStart}
      style={{
        paddingLeft: `${depth * INDENT_SIZE + 8 + (depth > 0 ? 4 : 0)}px`,
        paddingRight: "8px",
      }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      disabled={disabled}
    >
      {icon ? (
        <span className="flex shrink-0 items-center opacity-80 group-data-active:opacity-100">
          {icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-h-[18px] items-center gap-1">
          <SidebarItemLabel label={label} />
          {endContent}
        </span>
        {subtitle ? (
          <span className="truncate text-gray-10 group-data-active:text-gray-11">
            {subtitle}
          </span>
        ) : null}
      </span>
    </Button>
  );
}
