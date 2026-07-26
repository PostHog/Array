import { Button, cn } from "@posthog/quill";
import type { SidebarItemAction } from "@posthog/ui/features/sidebar/types";
import { useEffect, useRef, useState } from "react";

export const INDENT_SIZE = 8;

const TICKER_SPEED_PX_PER_SECOND = 50;
const TICKER_FADE_PX = 24;

export function getSidebarItemPaddingLeft(depth: number): string {
  return `${depth * INDENT_SIZE + 8 + (depth > 0 ? 4 : 0)}px`;
}

interface SidebarItemProps {
  depth: number;
  icon?: React.ReactNode;
  label: React.ReactNode;
  subtitle?: React.ReactNode;
  isActive?: boolean;
  isSelected?: boolean;
  isDimmed?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  action?: SidebarItemAction;
  /** Hugs the label but never truncates with it; pushes endContent right. */
  badge?: React.ReactNode;
  endContent?: React.ReactNode;
  disabled?: boolean;
}

function SidebarItemLabel({
  label,
  grow,
  revealOverflow,
}: {
  label: React.ReactNode;
  grow: boolean;
  revealOverflow: boolean;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const [overflowPx, setOverflowPx] = useState(0);
  const [reachedEnd, setReachedEnd] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;
    const measure = () => {
      setOverflowPx(Math.max(0, container.scrollWidth - container.clientWidth));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!revealOverflow) setReachedEnd(false);
  }, [revealOverflow]);

  const isTicking = revealOverflow && overflowPx > 0;

  return (
    <span
      ref={containerRef}
      className={cn(
        "min-w-0 overflow-hidden whitespace-nowrap",
        grow && "flex-1",
      )}
      style={{
        maskImage:
          overflowPx === 0
            ? undefined
            : isTicking
              ? reachedEnd
                ? `linear-gradient(to right, transparent, black ${TICKER_FADE_PX}px)`
                : `linear-gradient(to right, transparent, black ${TICKER_FADE_PX}px, black calc(100% - ${TICKER_FADE_PX}px), transparent)`
              : `linear-gradient(to right, black calc(100% - ${TICKER_FADE_PX}px), transparent)`,
      }}
    >
      <span
        ref={contentRef}
        className="inline-block"
        onTransitionEnd={(e) => {
          if (e.propertyName === "transform") setReachedEnd(true);
        }}
        style={
          isTicking
            ? {
                transform: `translateX(-${overflowPx}px)`,
                transitionProperty: "transform",
                transitionTimingFunction: "linear",
                transitionDuration: `${overflowPx / TICKER_SPEED_PX_PER_SECOND}s`,
              }
            : { transform: "translateX(0)", transitionProperty: "none" }
        }
      >
        {label}
      </span>
    </span>
  );
}

export function SidebarItem({
  depth,
  icon,
  label,
  subtitle,
  isActive,
  isSelected,
  isDimmed,
  draggable,
  onDragStart,
  onClick,
  onDoubleClick,
  onContextMenu,
  badge,
  endContent,
  disabled,
}: SidebarItemProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isKeyboardFocused, setIsKeyboardFocused] = useState(false);

  return (
    <Button
      type="button"
      className={cn(
        "group flex w-full cursor-default text-left text-[13px] leading-snug transition-colors",
        "focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent-8",
        "disabled:opacity-100 data-active:bg-fill-selected data-selected:bg-(--gray-3)",
        isDimmed && "opacity-50",
      )}
      data-active={isActive || undefined}
      data-selected={(isSelected && !isActive) || undefined}
      draggable={draggable}
      onDragStart={onDragStart}
      style={{
        paddingLeft: getSidebarItemPaddingLeft(depth),
        paddingRight: "8px",
      }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
      onFocus={(e) =>
        setIsKeyboardFocused(e.currentTarget.matches(":focus-visible"))
      }
      onBlur={() => setIsKeyboardFocused(false)}
      disabled={disabled}
    >
      {icon ? (
        <span className="flex shrink-0 items-center opacity-80 group-data-active:opacity-100">
          {icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-h-[18px] items-center gap-1">
          <SidebarItemLabel
            label={label}
            grow={!badge}
            revealOverflow={isHovered || isKeyboardFocused}
          />
          {badge ? (
            <span className="mr-auto ml-1 flex shrink-0 items-center">
              {badge}
            </span>
          ) : null}
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
