import { useEffect, useRef } from "react";

// Dia-style hover-peek gesture for the collapsed sidebar. Two pointer-position
// rules replace the old fixed 8px hover strip + mouseleave close:
//  - Reveal: crossing within PEEK_REVEAL_THRESHOLD px of the sidebar's window
//    edge peeks it out — proximity, not a pixel-perfect strip.
//  - Close: once peeked, only crossing past (sidebar far edge + PEEK_CLOSE_MARGIN)
//    into the content closes it. Leaving in any other direction — left, up,
//    down, off-window — keeps it open.
// Both thresholds are distance from the sidebar's own window edge, so the same
// math works for a left or right sidebar. Tunable.
export const PEEK_REVEAL_THRESHOLD = 24;
export const PEEK_CLOSE_MARGIN = 64;

// Only fires on the crossing from outside → inside the threshold, so a cursor
// already parked in the zone (e.g. right after a drag-to-close that released
// near the edge) can't re-trigger until it leaves and comes back.
export function shouldRevealOnEdge({
  pointer,
  wasInside,
  threshold,
}: {
  pointer: number;
  wasInside: boolean;
  threshold: number;
}): boolean {
  return pointer <= threshold && !wasInside;
}

// Directional close: only when the pointer moves decisively into the content,
// past the sidebar's far edge plus the margin.
export function shouldCloseOnExit({
  pointer,
  width,
  margin,
}: {
  pointer: number;
  width: number;
  margin: number;
}): boolean {
  return pointer > width + margin;
}

interface UseSidebarEdgeHoverPeekOptions {
  // Active only while the sidebar is collapsed and not being dragged.
  enabled: boolean;
  // Whether the peek overlay is currently shown — switches the listener from
  // "watch for reveal" to "watch for directional close".
  peeked: boolean;
  side: "left" | "right";
  // Current sidebar width; the close threshold is measured against it live so
  // resizing the panel keeps the gesture correct.
  width: number;
  onReveal: () => void;
  onClose: () => void;
}

export function useSidebarEdgeHoverPeek({
  enabled,
  peeked,
  side,
  width,
  onReveal,
  onClose,
}: UseSidebarEdgeHoverPeekOptions): void {
  // Read the latest props/callbacks inside the listener without re-subscribing
  // on every render (mirrors the ref pattern the drag lifecycle uses).
  const stateRef = useRef({ peeked, side, width, onReveal, onClose });
  stateRef.current = { peeked, side, width, onReveal, onClose };

  useEffect(() => {
    if (!enabled) return;

    // Assume "inside" on arm so an already-parked cursor must exit the reveal
    // zone once before it can peek — prevents an instant re-peek after a
    // drag-to-close that released near the edge.
    let wasInside = true;

    const handleMouseMove = (e: MouseEvent) => {
      const state = stateRef.current;
      // Distance from the sidebar's own window edge, regardless of side.
      const pointer =
        state.side === "left" ? e.clientX : window.innerWidth - e.clientX;

      if (state.peeked) {
        if (
          shouldCloseOnExit({
            pointer,
            width: state.width,
            margin: PEEK_CLOSE_MARGIN,
          })
        ) {
          state.onClose();
        }
      } else if (
        shouldRevealOnEdge({
          pointer,
          wasInside,
          threshold: PEEK_REVEAL_THRESHOLD,
        })
      ) {
        state.onReveal();
      }

      wasInside = pointer <= PEEK_REVEAL_THRESHOLD;
    };

    document.addEventListener("mousemove", handleMouseMove);
    return () => document.removeEventListener("mousemove", handleMouseMove);
  }, [enabled]);
}
