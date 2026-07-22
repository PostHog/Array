import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@posthog/quill";
import type { MessageRailMarker } from "./messageRailTypes";

export interface MessageScrollbarRailProps {
  /**
   * Markers to render, one per user message. The rail is responsible only for
   * painting them at the given fractional positions and wiring click/tooltip.
   */
  markers: MessageRailMarker[];
  /**
   * The browser scrollbar's intrinsic width in CSS pixels — used to size the
   * gutter the rail sits in so it lines up with (and visually replaces) the
   * native thumb. Defaults to 8px (the global `::-webkit-scrollbar` width).
   */
  scrollbarWidth?: number;
  /** Extra classes on the rail root. */
  className?: string;
}

/**
 * A vertical marker rail drawn in the scrollbar gutter of a conversation view.
 *
 * Each marker is positioned by a fractional `topPct` / `heightPct` of the
 * scrollable content height (the consumer converts measured row offsets into
 * those fractions). Clicking a marker calls its `onClick` (scroll-to-message);
 * hovering shows a tooltip with the message's first few words.
 *
 * The rail is `position: absolute` and pinned to the right edge, sized to the
 * native scrollbar gutter so it reads as part of the scrollbar rather than a
 * floating overlay. Its marker buttons are labelled so keyboard and assistive
 * technology users can jump directly to a message as well.
 */
export function MessageScrollbarRail({
  markers,
  scrollbarWidth = 8,
  className,
}: MessageScrollbarRailProps) {
  if (markers.length === 0) return null;

  return (
    <div
      className={cn(
        "pointer-events-none absolute top-0 right-0 z-10 h-full",
        className,
      )}
      style={{ width: scrollbarWidth }}
    >
      {markers.map((marker) => (
        <Tooltip key={marker.id}>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={marker.onClick}
                aria-labelledby={`message-rail-marker-${marker.id}`}
                // The marker button spans the rail's full width; its vertical
                // position is the fractional offset of the message within the
                // scrollable content.
                className="pointer-events-auto absolute left-0 w-full cursor-pointer border-0 bg-transparent p-0"
                style={{
                  top: `${marker.topPct * 100}%`,
                  height: `${Math.max(marker.heightPct * 100, 0.6)}%`,
                }}
              >
                <span
                  id={`message-rail-marker-${marker.id}`}
                  className="sr-only"
                >
                  Jump to message: {marker.label}
                </span>
                <span
                  className={cn(
                    "block h-full w-full rounded-full transition-colors",
                    marker.active
                      ? "bg-(--accent-9)"
                      : "bg-(--gray-10) hover:bg-(--gray-11)",
                  )}
                />
              </button>
            }
          />
          <TooltipContent side="left">{marker.label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
