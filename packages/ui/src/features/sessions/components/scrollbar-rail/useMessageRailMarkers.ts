import { useCallback, useEffect, useRef, useState } from "react";
import {
  MESSAGE_RAIL_LABEL_MAX_LENGTH,
  type MessageRailMarker,
  truncateMessageLabel,
} from "./messageRailTypes";

interface UserMessageEntry {
  id: string;
  content: string;
  /** Item index within the conversation — used to order markers. */
  index: number;
}

interface MeasuredOffset {
  top: number;
  height: number;
}

/**
 * Drives the scrollbar marker rail for a conversation view.
 *
 * Returns the markers the rail should paint. It measures each rendered
 * user-message row's `offsetTop`/`offsetHeight` inside `contentEl` (the scroll
 * container's inner content element), persists those measurements in a ref so a
 * marker stays put once its row has rendered even after it scrolls out of view,
 * and recomputes the fractional positions whenever the content scrolls, resizes,
 * or the DOM mutates (rows entering/leaving the virtualization window).
 *
 * Rows not yet rendered (virtualized views, e.g. the legacy `ConversationView`)
 * have no DOM node and therefore no measured offset; their markers are placed
 * by linearly interpolating between the nearest measured neighbours using their
 * item indices, which is accurate enough for a click target and self-corrects the
 * moment the row renders. (Non-virtualized views like the new `ChatThread`
 * render every row, so every marker is measured directly.)
 *
 * @param contentEl       The scroll container's inner content element (the tall
 *                        div whose height == total content height). Offsets are
 *                        read relative to it.
 * @param scrollEl        The scrolling element (has `scrollTop`/`scrollHeight`).
 *                        Used to trigger marker refresh on scroll. If omitted,
 *                        only mutation/resize trigger refresh.
 * @param userMessages    Ordered `{ id, content, index }` entries, one per user
 *                        message in the conversation.
 * @param onJump          Scrolls the conversation to the message with this id.
 * @param activeId        Currently keyboard-focused message id (highlighted).
 * @param rowAttribute    The data attribute stamped on each message row, used to
 *                        locate it in the DOM. Defaults to
 *                        `data-conversation-item-id` (the legacy view); the new
 *                        `ChatThread` uses `data-message-id`.
 */
export function useMessageRailMarkers({
  contentEl,
  scrollEl,
  userMessages,
  onJump,
  activeId,
  rowAttribute = "data-conversation-item-id",
}: {
  contentEl: HTMLElement | null;
  scrollEl: HTMLElement | null;
  userMessages: readonly UserMessageEntry[];
  onJump: (id: string) => void;
  activeId?: string | null;
  rowAttribute?: string;
}): MessageRailMarker[] {
  // Persisted measurements keyed by item id. Stable across renders; updated by
  // the measure pass. Keeping them in a ref (not state) avoids re-renders on
  // every scroll tick — a `version` counter triggers the one re-render we need.
  const measuredRef = useRef<Map<string, MeasuredOffset>>(new Map());
  const [version, setVersion] = useState(0);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  // Hold the latest inputs in refs so `measure` is referentially stable —
  // otherwise a fresh `userMessages` array each render would tear down and
  // rebuild the scroll/mutation/resize observers every render.
  const contentElRef = useRef(contentEl);
  contentElRef.current = contentEl;
  const userMessagesRef = useRef(userMessages);
  userMessagesRef.current = userMessages;
  const rowAttributeRef = useRef(rowAttribute);
  rowAttributeRef.current = rowAttribute;

  // Re-measure rendered user-message rows and persist their offsets.
  const measure = useCallback(() => {
    const content = contentElRef.current;
    if (!content) return;
    let changed = false;
    const map = measuredRef.current;
    const attr = rowAttributeRef.current;
    // Content's top in viewport coords; subtracting it from each row's top
    // yields the row's position within the content (scroll-invariant, since
    // both move together). `offsetTop` can't be used directly because virtual
    // list rows live in a `transform`-ed wrapper that becomes the offset parent.
    const contentTop = content.getBoundingClientRect().top;
    // Collect all rendered rows in a single DOM pass and index them by id,
    // rather than one `querySelector` per message: in the long threads this
    // rail targets, a per-message query on every scroll frame is hundreds or
    // thousands of synchronous DOM lookups. `querySelectorAll` walks the
    // (virtualized, bounded) rendered set once.
    const rowById = new Map<string, HTMLElement>();
    for (const row of content.querySelectorAll<HTMLElement>(`[${attr}]`)) {
      const id = row.getAttribute(attr);
      if (id != null) rowById.set(id, row);
    }
    for (const entry of userMessagesRef.current) {
      const row = rowById.get(entry.id);
      if (!row) continue;
      const rect = row.getBoundingClientRect();
      const top = rect.top - contentTop;
      const height = rect.height;
      const prev = map.get(entry.id);
      if (!prev || prev.top !== top || prev.height !== height) {
        map.set(entry.id, { top, height });
        changed = true;
      }
    }
    if (changed) bump();
  }, [bump]);

  // Coalesce observer/scroll-driven measures to at most one per animation
  // frame — a burst of scroll or mutation events within a frame only needs a
  // single re-measure. Cancelled on unmount via the ref below.
  const frameRef = useRef<number | null>(null);
  const scheduleMeasure = useCallback(() => {
    if (frameRef.current != null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      measure();
    });
  }, [measure]);

  // Refresh on scroll (positions change as the thumb moves) + on DOM mutation
  // (rows entering/leaving the virtualization window) + on content resize.
  useEffect(() => {
    if (!contentEl) return;
    // Measure synchronously on mount so markers paint on the first frame; later
    // event-driven measures are frame-coalesced through `scheduleMeasure`.
    measure();
    const mutation = new MutationObserver(scheduleMeasure);
    mutation.observe(contentEl, { childList: true, subtree: true });
    const resize = new ResizeObserver(() => {
      // Virtualized layout changes can move offscreen rows without remounting
      // them. Their cached offsets are no longer trustworthy, so drop them and
      // let the next marker build interpolate from the freshly measured rows.
      // Keeping stale values here can place markers outside the content bounds.
      if (measuredRef.current.size > 0) {
        measuredRef.current.clear();
        bump();
      }
      scheduleMeasure();
    });
    resize.observe(contentEl);
    const scroll = scrollEl ?? contentEl;
    scroll.addEventListener("scroll", scheduleMeasure, { passive: true });
    return () => {
      mutation.disconnect();
      resize.disconnect();
      scroll.removeEventListener("scroll", scheduleMeasure);
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [contentEl, scrollEl, measure, scheduleMeasure, bump]);

  // Drop stale ids (removed messages) so markers don't linger after compaction.
  useEffect(() => {
    const map = measuredRef.current;
    const keep = new Set(userMessages.map((m) => m.id));
    let changed = false;
    for (const id of map.keys()) {
      if (!keep.has(id)) {
        map.delete(id);
        changed = true;
      }
    }
    if (changed) bump();
  }, [userMessages, bump]);

  // Build the markers: fractional position = measured offset / total content
  // height. Unmeasured rows are interpolated between their nearest measured
  // neighbours by array position.
  const markers: MessageRailMarker[] = [];
  if (contentEl && userMessages.length > 0) {
    const total = contentEl.scrollHeight;
    const map = measuredRef.current;

    for (let i = 0; i < userMessages.length; i++) {
      const entry = userMessages[i];
      const measured = map.get(entry.id);
      let top: number;
      let height: number;
      if (measured) {
        top = measured.top;
        height = measured.height;
      } else {
        const interp = interpolateOffset(userMessages, map, i);
        top = interp.top;
        height = interp.height;
      }
      markers.push({
        id: entry.id,
        topPct: total > 0 ? top / total : 0,
        heightPct: total > 0 ? height / total : 0,
        label: truncateMessageLabel(
          entry.content,
          MESSAGE_RAIL_LABEL_MAX_LENGTH,
        ),
        active: activeId === entry.id,
        onClick: () => onJump(entry.id),
      });
    }
  }

  // `version` is read here so the hook re-runs the build above when measurements
  // update. Without referencing it, TS would flag it unused; keep the reference.
  void version;
  return markers;
}

/** Estimate the offset of an unmeasured row by interpolating between its nearest
 * measured neighbours by array position. Falls back to the estimate-size heuristic
 * (a per-row fraction of total height) when there are no neighbours at all. */
function interpolateOffset(
  userMessages: readonly UserMessageEntry[],
  measured: Map<string, MeasuredOffset>,
  index: number,
): MeasuredOffset {
  // Walk outward from `index` to find the previous and next measured entries.
  let prevIdx = -1;
  for (let i = index - 1; i >= 0; i--) {
    if (measured.has(userMessages[i].id)) {
      prevIdx = i;
      break;
    }
  }
  let nextIdx = -1;
  for (let i = index + 1; i < userMessages.length; i++) {
    if (measured.has(userMessages[i].id)) {
      nextIdx = i;
      break;
    }
  }

  const prev = prevIdx >= 0 ? measured.get(userMessages[prevIdx].id) : null;
  const next = nextIdx >= 0 ? measured.get(userMessages[nextIdx].id) : null;
  const ESTIMATE = 80;

  if (prev && next && nextIdx > prevIdx) {
    // Lerp between the two measured neighbours.
    const span = nextIdx - prevIdx;
    const t = (index - prevIdx) / span;
    const top = prev.top + (next.top - prev.top) * t;
    return { top, height: ESTIMATE };
  }
  if (prev) {
    return {
      top: prev.top + prev.height + (index - prevIdx) * ESTIMATE,
      height: ESTIMATE,
    };
  }
  if (next) {
    return {
      top: Math.max(0, next.top - (nextIdx - index) * ESTIMATE),
      height: ESTIMATE,
    };
  }
  return { top: index * ESTIMATE, height: ESTIMATE };
}
