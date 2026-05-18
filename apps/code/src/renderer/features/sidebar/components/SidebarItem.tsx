import { Tooltip } from "@components/ui/Tooltip";
import { Button, cn } from "@posthog/quill";
import { useCallback, useRef, useState } from "react";
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
  const labelRef = useRef<HTMLSpanElement>(null);
  const [showLabelTooltip, setShowLabelTooltip] = useState(false);
  const canShowLabelTooltip =
    typeof label === "string" || typeof label === "number";

  const handleLabelMouseEnter = useCallback(() => {
    const el = labelRef.current;
    if (el && el.scrollWidth > el.clientWidth) {
      setShowLabelTooltip(true);
    }
  }, []);

  const handleLabelMouseLeave = useCallback(() => {
    setShowLabelTooltip(false);
  }, []);

  const labelSpan = (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover handlers only drive a visual tooltip for truncated labels
    <span
      ref={labelRef}
      className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
      onMouseEnter={canShowLabelTooltip ? handleLabelMouseEnter : undefined}
      onMouseLeave={canShowLabelTooltip ? handleLabelMouseLeave : undefined}
    >
      {label}
    </span>
  );

  return (
    <Button
      type="button"
      className={cn(
        "group focus-visible:-outline-offset-2 flex w-full text-left text-[13px] leading-snug transition-colors focus-visible:outline-2 focus-visible:outline-accent-8",
        "cursor-default disabled:opacity-100 data-active:bg-fill-selected",
      )}
      data-active={isActive || undefined}
      draggable={draggable}
      onDragStart={onDragStart}
      style={{
        paddingLeft: `${depth * INDENT_SIZE + 8 + (depth > 0 ? 4 : 0)}px`,
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
      <span className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <span className="flex h-[18px] items-center gap-1">
          {canShowLabelTooltip ? (
            <Tooltip content={label} open={showLabelTooltip} side="top">
              {labelSpan}
            </Tooltip>
          ) : (
            labelSpan
          )}
          {endContent}
        </span>
        {subtitle && (
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-gray-10 group-data-active:text-gray-11">
            {subtitle}
          </span>
        )}
      </span>
    </Button>
  );
}
