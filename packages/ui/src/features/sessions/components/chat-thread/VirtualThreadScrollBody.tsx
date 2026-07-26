import {
  ChatMessageScroller,
  ChatMessageScrollerButton,
  ChatMessageScrollerContent,
  ChatMessageScrollerViewport,
  cn,
} from "@posthog/quill";
import type { ConversationItem } from "@posthog/ui/features/sessions/components/buildConversationItems";
import { VirtualStickyHeader } from "@posthog/ui/features/sessions/components/chat-thread/ThreadStickyHeader";
import {
  computeStickyAnchor,
  type FlatThreadRow,
  SCROLL_PREVIOUS_ITEM_PEEK,
  type StickyAnchorEntry,
  type StickyAnchorState,
  type ThreadScrollResume,
} from "@posthog/ui/features/sessions/components/chat-thread/threadVirtualization";
import { MessageScrollbarRail } from "@posthog/ui/features/sessions/components/scrollbar-rail/MessageScrollbarRail";
import { useMessageRailMarkers } from "@posthog/ui/features/sessions/components/scrollbar-rail/useMessageRailMarkers";
import { CHAT_CONTENT_MAX_WIDTH } from "@posthog/ui/features/sessions/constants";
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// Windowing geometry. Estimate/overscan/drift values match the legacy VirtualizedList, whose
// tuning these rows share (same item mix, same measure-then-settle churn).
const ESTIMATED_ROW_SIZE = 80;
const OVERSCAN = 12;
/** Matches the Provider's `scrollEdgeThreshold` so "at bottom" agrees between engine and windowing. */
const AT_BOTTOM_THRESHOLD = 100;
// A real upward drift, not a 1-frame measure transient: the DOM bottom sits this far below the
// viewport. Well above any single append's measure gap.
const FAR_DRIFT_THRESHOLD = 400;
/** Top of the virtual coordinate space — stands in for the non-virtualized content's `py-4`. */
const PADDING_START = 16;
/** Frames a programmatic scroll keeps re-issuing while rows around the target still measure. */
const SETTLE_AT_END_ATTEMPTS = 12;
const SETTLE_TO_INDEX_ATTEMPTS = 8;

type ThreadVirtualizer = Virtualizer<HTMLDivElement, Element>;

/** A user message's position in the flat row list, for the sticky anchor and the scrollbar rail. */
interface UserRow {
  id: string;
  content: string;
  index: number;
}

/**
 * Reserves the footer's height as virtual `paddingEnd` rather than rendering it as a virtual row:
 * a footer row's key would be constant and always last, which permanently kills tanstack's
 * `followOnAppend` (it only fires when the last virtual key changes). With the footer out of the
 * count the last virtual item is the real last message, and the virtual end still lines up with
 * the real DOM bottom.
 */
function useReservedFooterHeight(
  footerRef: RefObject<HTMLDivElement | null>,
  hasFooter: boolean,
): number {
  const [footerHeight, setFooterHeight] = useState(0);
  useLayoutEffect(() => {
    const el = footerRef.current;
    const measure = () => {
      const height = hasFooter && el ? el.offsetHeight : 0;
      setFooterHeight((prev) => (prev === height ? prev : height));
    };
    measure();
    if (!hasFooter || !el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasFooter, footerRef]);
  return footerHeight;
}

/**
 * Programmatic scrolls that survive measurement drift. Rows are estimated until they mount, so a
 * single `scrollToEnd`/`scrollToIndex` lands short; both helpers re-issue across frames until the
 * target offset stops moving. `isAtBottomRef` is the follow flag the rest of the body reads.
 */
function useSettleControls(
  virtualizer: ThreadVirtualizer,
  viewportRef: RefObject<HTMLDivElement | null>,
) {
  // Starts true; the mount-position effect below flips it if the handoff state says the reader was
  // parked above the fold.
  const isAtBottomRef = useRef(true);
  const settleRafRef = useRef<number | null>(null);

  const cancelSettle = useCallback(() => {
    if (settleRafRef.current !== null) {
      cancelAnimationFrame(settleRafRef.current);
      settleRafRef.current = null;
    }
  }, []);

  const settleAtEnd = useCallback(() => {
    cancelSettle();
    isAtBottomRef.current = true;
    let attempts = 0;
    const step = () => {
      virtualizer.scrollToEnd();
      if (
        virtualizer.isAtEnd(AT_BOTTOM_THRESHOLD) ||
        ++attempts > SETTLE_AT_END_ATTEMPTS
      ) {
        settleRafRef.current = null;
        return;
      }
      settleRafRef.current = requestAnimationFrame(step);
    };
    step();
  }, [virtualizer, cancelSettle]);

  const settleToIndex = useCallback(
    (index: number) => {
      cancelSettle();
      isAtBottomRef.current = false;
      virtualizer.scrollToIndex(index, { align: "start" });
      let attempts = 0;
      const step = () => {
        settleRafRef.current = null;
        const viewport = viewportRef.current;
        const target = virtualizer.getOffsetForIndex(index, "start")?.[0];
        if (!viewport || target == null) return;
        const maxScroll = Math.max(
          0,
          viewport.scrollHeight - viewport.clientHeight,
        );
        if (
          Math.abs(viewport.scrollTop - Math.min(target, maxScroll)) <= 1 ||
          ++attempts > SETTLE_TO_INDEX_ATTEMPTS
        ) {
          return;
        }
        virtualizer.scrollToIndex(index, { align: "start" });
        settleRafRef.current = requestAnimationFrame(step);
      };
      settleRafRef.current = requestAnimationFrame(step);
    },
    [virtualizer, viewportRef, cancelSettle],
  );

  useEffect(() => cancelSettle, [cancelSettle]);

  return { isAtBottomRef, settleAtEnd, settleToIndex };
}

/**
 * Sticky-header anchor derived from the virtualizer's measurements (estimated for rows that have
 * never mounted, exact once measured), recomputed at most once per frame. Returns the state plus
 * the scheduler the scroll handler pokes.
 */
function useStickyAnchor(
  virtualizer: ThreadVirtualizer,
  viewportRef: RefObject<HTMLDivElement | null>,
  userRows: readonly UserRow[],
) {
  const [state, setState] = useState<StickyAnchorState>({
    anchorId: null,
    offscreen: false,
  });

  const recompute = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const cache = virtualizer.measurementsCache;
    const entries: StickyAnchorEntry[] = userRows.map((user) => {
      const measured = cache[user.index];
      const start = measured?.start ?? user.index * ESTIMATED_ROW_SIZE;
      const end = measured?.end ?? start + ESTIMATED_ROW_SIZE;
      return { id: user.id, start, end };
    });
    const next = computeStickyAnchor(
      entries,
      viewport.scrollTop,
      SCROLL_PREVIOUS_ITEM_PEEK,
    );
    setState((prev) =>
      prev.anchorId === next.anchorId && prev.offscreen === next.offscreen
        ? prev
        : next,
    );
  }, [userRows, virtualizer, viewportRef]);

  const frameRef = useRef<number | null>(null);
  const schedule = useCallback(() => {
    if (frameRef.current != null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      recompute();
    });
  }, [recompute]);

  // Re-derive on mount and whenever the row set changes (content growth moves every anchor below).
  useEffect(() => {
    schedule();
    return () => {
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [schedule]);

  return { state, schedule };
}

/**
 * Keeps the view pinned to the bottom while following. Three triggers, all of which the
 * virtualizer's own `anchorTo`/`followOnAppend` miss:
 * - `totalSize` moving (rows remeasuring past the estimate, late async content growing rows, the
 *   footer resize feeding `paddingEnd`) — a layout effect so the re-pin lands before paint;
 * - a prompt submitted from anywhere, which re-engages follow (the trigger `ThreadAutoFollow` uses
 *   in the non-virtualized body);
 * - returning to a backgrounded tab, where ResizeObserver callbacks were throttled.
 */
function useFollowBottom({
  virtualizer,
  totalSize,
  items,
  isAtBottomRef,
  settleAtEnd,
}: {
  virtualizer: ThreadVirtualizer;
  totalSize: number;
  items: ConversationItem[];
  isAtBottomRef: RefObject<boolean>;
  settleAtEnd: () => void;
}) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: totalSize is the trigger, not a body dependency
  useLayoutEffect(() => {
    if (!isAtBottomRef.current) return;
    virtualizer.scrollToEnd();
  }, [totalSize, virtualizer, isAtBottomRef]);

  const lastItem = items.at(-1);
  const userMessageCount = useMemo(
    () =>
      items.reduce((n, item) => (item.type === "user_message" ? n + 1 : n), 0),
    [items],
  );
  const prevUserCountRef = useRef(userMessageCount);
  useLayoutEffect(() => {
    const previous = prevUserCountRef.current;
    prevUserCountRef.current = userMessageCount;
    if (previous === 0 || userMessageCount <= previous) return;
    if (lastItem?.type !== "user_message") return;
    settleAtEnd();
  }, [userMessageCount, lastItem, settleAtEnd]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && isAtBottomRef.current) settleAtEnd();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [settleAtEnd, isAtBottomRef]);
}

/**
 * Dev-build overlay confirming the windowed renderer is live, and how much of the thread it is
 * actually mounting. A mounted count that tracks the total instead of staying flat means windowing
 * isn't doing its job.
 */
function WindowedDebugBadge({
  mounted,
  total,
}: {
  mounted: number;
  total: number;
}) {
  return (
    <div className="pointer-events-none absolute top-2 left-2 z-20 rounded bg-amber-9 px-1.5 py-0.5 font-mono text-[10px] text-white leading-none">
      windowed {mounted}/{total}
    </div>
  );
}

/**
 * Windowed scroll body for long threads, following the upstream MessageScroller guidance:
 * virtualization lives outside the primitive — the quill viewport stays the scroll element and a
 * `@tanstack/react-virtual` virtualizer owns the rows inside `ChatMessageScrollerContent`.
 *
 * The engine still provides the chrome that only needs scroll geometry (the scroll-to-bottom
 * button and edge state read real element measurements), while everything item-based gets a
 * windowed implementation here: follow-bottom via `anchorTo: "end"` + `followOnAppend` (the legacy
 * `VirtualizedList` recipe), message jumps via `scrollToIndex`, the sticky header via
 * `computeStickyAnchor` over the virtualizer's measurements, and the scrollbar rail via its
 * existing interpolate-unmounted-rows path.
 */
export function VirtualThreadScrollBody({
  items,
  flatRows,
  renderRow,
  footer,
  keyboardFocusedMessageId,
  onUserInteract,
  renderNav,
  resumeRef,
}: {
  items: ConversationItem[];
  flatRows: FlatThreadRow[];
  renderRow: (row: FlatThreadRow) => ReactNode;
  /** Status row (duration / context usage) pinned as the last item in the thread. */
  footer?: ReactNode;
  keyboardFocusedMessageId?: string | null;
  /** Clears keyboard-focused message state on any pointer interaction with the thread. */
  onUserInteract?: () => void;
  /**
   * Navigation layer, rendered as a sibling of the scroller so it can be handed this body's jump
   * implementation — the engine's `scrollToMessage` only reaches mounted rows.
   */
  renderNav?: (jumpToMessage: (id: string) => void) => ReactNode;
  /** Where the non-virtualized body left off, read once when this body takes over mid-session. */
  resumeRef: RefObject<ThreadScrollResume>;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const initializedRef = useRef(false);
  const lastScrollTopRef = useRef(0);

  const hasFooter = footer != null;
  const footerHeight = useReservedFooterHeight(footerRef, hasFooter);

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => ESTIMATED_ROW_SIZE,
    overscan: OVERSCAN,
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: AT_BOTTOM_THRESHOLD,
    paddingStart: PADDING_START,
    paddingEnd: footerHeight,
    getItemKey: (index) => flatRows[index]?.key ?? index,
  });

  const { isAtBottomRef, settleAtEnd, settleToIndex } = useSettleControls(
    virtualizer,
    viewportRef,
  );

  const userRows = useMemo(() => {
    const result: UserRow[] = [];
    flatRows.forEach((row, index) => {
      if (row.item.type === "user_message") {
        result.push({ id: row.item.id, content: row.item.content, index });
      }
    });
    return result;
  }, [flatRows]);

  // Held in a ref so `jumpToMessage` stays referentially stable across appends — it is handed to
  // the nav layer and to the sticky header, neither of which should re-render per streamed chunk.
  const rowIndexByMessageId = useMemo(() => {
    const map = new Map<string, number>();
    flatRows.forEach((row, index) => {
      map.set(row.item.id, index);
    });
    return map;
  }, [flatRows]);
  const rowIndexRef = useRef(rowIndexByMessageId);
  rowIndexRef.current = rowIndexByMessageId;

  const jumpToMessage = useCallback(
    (id: string) => {
      const index = rowIndexRef.current.get(id);
      if (index != null) settleToIndex(index);
    },
    [settleToIndex],
  );

  // Initial position: resume at the message the non-virtualized body was anchored to, or settle at
  // the bottom. Resuming by row index rather than by pixel offset is what makes the handoff land —
  // the two bodies don't share a coordinate space (virtual offsets are estimates until rows
  // measure), so a recorded `scrollTop` would mean nothing here.
  useLayoutEffect(() => {
    if (initializedRef.current || flatRows.length === 0) return;
    initializedRef.current = true;
    const { atBottom, anchorId } = resumeRef.current;
    const anchorIndex =
      anchorId != null ? rowIndexRef.current.get(anchorId) : undefined;
    if (!atBottom && anchorIndex != null) {
      settleToIndex(anchorIndex);
      return;
    }
    settleAtEnd();
  }, [flatRows.length, settleAtEnd, settleToIndex, resumeRef]);

  const { state: stickyState, schedule: scheduleStickyRecompute } =
    useStickyAnchor(virtualizer, viewportRef, userRows);

  const handleScroll = useCallback(() => {
    const el = viewportRef.current;
    const scrollTop = el?.scrollTop ?? 0;
    // Tolerate sub-pixel jitter; only a real upward move counts as leaving end.
    const scrolledUp = scrollTop < lastScrollTopRef.current - 1;
    lastScrollTopRef.current = scrollTop;

    const atEnd = virtualizer.isAtEnd(AT_BOTTOM_THRESHOLD);
    // Genuine far drift (not a 1-frame measure transient): the DOM bottom sits well below the
    // viewport, so follow can't get silently stuck mid-thread.
    const farFromEnd = el
      ? el.scrollHeight - el.clientHeight - scrollTop > FAR_DRIFT_THRESHOLD
      : false;
    // Hysteresis: each append measures taller than the estimate, so for one frame isAtEnd reads
    // false before followOnAppend/anchorTo re-pin. Re-arm at the end; only clear on a real upward
    // scroll or a genuine drift.
    if (atEnd) {
      isAtBottomRef.current = true;
    } else if (scrolledUp || farFromEnd) {
      isAtBottomRef.current = false;
    }
    scheduleStickyRecompute();
  }, [virtualizer, scheduleStickyRecompute, isAtBottomRef]);

  const totalSize = virtualizer.getTotalSize();
  useFollowBottom({
    virtualizer,
    totalSize,
    items,
    isAtBottomRef,
    settleAtEnd,
  });

  const railMarkers = useMessageRailMarkers({
    contentEl,
    scrollEl: viewportEl,
    userMessages: userRows,
    onJump: jumpToMessage,
    activeId: keyboardFocusedMessageId,
    rowAttribute: "data-message-id",
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <>
      <ChatMessageScroller
        // The dev-only ring makes it obvious at a glance which renderer is live — the two bodies
        // are otherwise pixel-identical, so "did the threshold actually trip?" is unanswerable
        // without it. Inset so it doesn't shift layout.
        className={cn(
          "group/thread",
          import.meta.env.DEV && "ring-1 ring-amber-8 ring-inset",
        )}
        onPointerDownCapture={onUserInteract}
      >
        {import.meta.env.DEV && (
          <WindowedDebugBadge
            mounted={virtualItems.length}
            total={flatRows.length}
          />
        )}
        <VirtualStickyHeader
          items={items}
          anchorId={stickyState.anchorId}
          offscreen={stickyState.offscreen}
          onJump={jumpToMessage}
        />
        <MessageScrollbarRail markers={railMarkers} />
        <ChatMessageScrollerViewport
          ref={(el: HTMLDivElement | null) => {
            viewportRef.current = el;
            setViewportEl(el);
          }}
          onScroll={handleScroll}
        >
          {/* `block` overrides the content's flex+gap layout — spacing moves into the rows
              (pb-4) and the virtual paddings, so translateY offsets are the whole layout. */}
          <ChatMessageScrollerContent className="block" density="default">
            <div
              ref={setContentEl}
              className="relative w-full"
              style={{ height: totalSize }}
            >
              {virtualItems.map((virtualItem) => {
                const row = flatRows[virtualItem.index];
                if (!row) return null;
                return (
                  <div
                    key={virtualItem.key}
                    ref={virtualizer.measureElement}
                    data-index={virtualItem.index}
                    className="absolute top-0 left-0 w-full"
                    style={{ transform: `translateY(${virtualItem.start}px)` }}
                  >
                    {renderRow(row)}
                  </div>
                );
              })}
              {/* Footer occupies the reserved paddingEnd region at the very bottom of the virtual
                  space, so the DOM bottom == the virtual end. */}
              {hasFooter && (
                <div
                  ref={footerRef}
                  className="absolute bottom-0 left-0 w-full"
                >
                  <div
                    className="mx-auto w-full px-2.5 pb-8"
                    style={{ maxWidth: CHAT_CONTENT_MAX_WIDTH }}
                  >
                    {footer}
                  </div>
                </div>
              )}
            </div>
          </ChatMessageScrollerContent>
        </ChatMessageScrollerViewport>
        <ChatMessageScrollerButton
          onClick={(event: ReactMouseEvent) => {
            // The engine's own scroll-to-end targets the current scrollHeight, which is an
            // estimate until every row between here and the bottom has measured — settle instead.
            // (The primitive skips its own handler once the event is defaultPrevented.)
            event.preventDefault();
            settleAtEnd();
          }}
        />
      </ChatMessageScroller>
      {renderNav?.(jumpToMessage)}
    </>
  );
}
