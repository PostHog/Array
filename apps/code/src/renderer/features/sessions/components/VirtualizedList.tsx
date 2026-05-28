import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type CSSProperties,
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

interface VirtualizedListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  getItemKey?: (item: T, index: number) => string | number;
  className?: string;
  itemClassName?: string;
  itemStyle?: CSSProperties;
  footer?: ReactNode;
  onScrollStateChange?: (isAtBottom: boolean) => void;
  keepMounted?: readonly number[];
}

export interface VirtualizedListHandle {
  scrollToBottom: () => void;
  scrollToIndex: (index: number) => void;
}

const AT_BOTTOM_THRESHOLD = 50;
const ESTIMATED_ROW_SIZE = 80;
const OVERSCAN = 6;
const FOOTER_KEY = "__virtualized_footer__";

function VirtualizedListInner<T>(
  {
    items,
    renderItem,
    getItemKey,
    className,
    itemClassName,
    itemStyle,
    footer,
    onScrollStateChange,
    keepMounted,
  }: VirtualizedListProps<T>,
  ref: React.ForwardedRef<VirtualizedListHandle>,
) {
  const parentRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const isAtBottomRef = useRef(true);
  const settlingRef = useRef(false);
  const settleRafRef = useRef<number | null>(null);
  const onScrollStateChangeRef = useRef(onScrollStateChange);
  onScrollStateChangeRef.current = onScrollStateChange;

  const hasFooter = footer != null;
  const totalCount = items.length + (hasFooter ? 1 : 0);

  const virtualizer = useVirtualizer({
    count: totalCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_SIZE,
    overscan: OVERSCAN,
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: AT_BOTTOM_THRESHOLD,
    getItemKey: (index) => {
      if (hasFooter && index === items.length) return FOOTER_KEY;
      const item = items[index];
      return getItemKey ? getItemKey(item, index) : index;
    },
  });

  const settleAtEnd = useCallback(() => {
    if (settleRafRef.current !== null) {
      cancelAnimationFrame(settleRafRef.current);
      settleRafRef.current = null;
    }
    settlingRef.current = true;
    isAtBottomRef.current = true;
    let attempts = 0;
    const step = () => {
      virtualizer.scrollToEnd();
      if (virtualizer.isAtEnd(AT_BOTTOM_THRESHOLD)) {
        settlingRef.current = false;
        settleRafRef.current = null;
        if (initializedRef.current) {
          onScrollStateChangeRef.current?.(true);
        }
        return;
      }
      if (++attempts > 12) {
        settlingRef.current = false;
        settleRafRef.current = null;
        return;
      }
      settleRafRef.current = requestAnimationFrame(step);
    };
    step();
  }, [virtualizer]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: settleAtEnd,
      scrollToIndex: (index: number) => {
        if (settleRafRef.current !== null) {
          cancelAnimationFrame(settleRafRef.current);
          settleRafRef.current = null;
          settlingRef.current = false;
        }
        isAtBottomRef.current = false;
        virtualizer.scrollToIndex(index, { align: "center" });
      },
    }),
    [virtualizer, settleAtEnd],
  );

  useEffect(() => {
    return () => {
      if (settleRafRef.current !== null) {
        cancelAnimationFrame(settleRafRef.current);
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (initializedRef.current || totalCount === 0) return;
    virtualizer.scrollToEnd();
    requestAnimationFrame(() => {
      initializedRef.current = true;
    });
  }, [totalCount, virtualizer]);

  // Safety net: streaming tokens grow an existing row in place; neither
  // followOnAppend (count-based) nor anchorTo='end' (above-viewport-resize)
  // covers in-place growth of the last row. Re-pin to end when at-bottom.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on items mutation, including streaming text updates
  useEffect(() => {
    if (!initializedRef.current) return;
    if (!isAtBottomRef.current) return;
    virtualizer.scrollToEnd();
  }, [items, virtualizer]);

  const handleScroll = useCallback(() => {
    const atBottom = virtualizer.isAtEnd(AT_BOTTOM_THRESHOLD);
    isAtBottomRef.current = atBottom;
    if (!initializedRef.current) return;
    // Suppress intermediate "not at bottom" pings while a programmatic
    // scrollToEnd is still settling after row remeasure.
    if (settlingRef.current && !atBottom) return;
    onScrollStateChangeRef.current?.(atBottom);
  }, [virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();

  const renderedIndices = useMemo(() => {
    const set = new Set<number>();
    for (const v of virtualItems) set.add(v.index);
    return set;
  }, [virtualItems]);

  const orphanKeepIndices = useMemo(() => {
    if (!keepMounted || keepMounted.length === 0) return [];
    return keepMounted.filter(
      (i) => i >= 0 && i < items.length && !renderedIndices.has(i),
    );
  }, [keepMounted, renderedIndices, items.length]);

  return (
    <div className={`flex h-full flex-col ${className ?? ""}`}>
      <div
        ref={parentRef}
        onScroll={handleScroll}
        className="scroll-mask-8 flex-1 overflow-auto"
        style={{ scrollbarGutter: "stable" }}
      >
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: "relative",
            width: "100%",
          }}
        >
          {virtualItems.map((virtualItem) => {
            const isFooter = hasFooter && virtualItem.index === items.length;
            const item = isFooter ? null : items[virtualItem.index];
            const itemKey = isFooter
              ? FOOTER_KEY
              : getItemKey
                ? getItemKey(item as T, virtualItem.index)
                : virtualItem.index;
            return (
              <div
                key={virtualItem.key}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <div
                  className={itemClassName}
                  style={itemStyle}
                  data-conversation-item-id={itemKey}
                >
                  {isFooter ? footer : renderItem(item as T, virtualItem.index)}
                </div>
              </div>
            );
          })}
          {orphanKeepIndices.map((index) => {
            const item = items[index];
            const k = getItemKey ? getItemKey(item, index) : index;
            return (
              <div
                key={`keep-${k}`}
                aria-hidden
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: "translateY(-99999px)",
                  pointerEvents: "none",
                  visibility: "hidden",
                }}
              >
                <div
                  className={itemClassName}
                  style={itemStyle}
                  data-conversation-item-id={k}
                >
                  {renderItem(item, index)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const VirtualizedList = forwardRef(VirtualizedListInner) as <T>(
  props: VirtualizedListProps<T> & {
    ref?: React.ForwardedRef<VirtualizedListHandle>;
  },
) => ReturnType<typeof VirtualizedListInner>;
