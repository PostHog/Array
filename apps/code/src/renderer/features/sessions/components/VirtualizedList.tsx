import {
  type CSSProperties,
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import { VList, type VListHandle } from "virtua";

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
  const listRef = useRef<VListHandle>(null);
  const isAtBottomRef = useRef(true);
  const initializedRef = useRef(false);
  const onScrollStateChangeRef = useRef(onScrollStateChange);
  onScrollStateChangeRef.current = onScrollStateChange;
  const itemCountRef = useRef(items.length);
  itemCountRef.current = items.length;

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: () => {
        const handle = listRef.current;
        if (handle) {
          handle.scrollTo(handle.scrollSize);
          isAtBottomRef.current = true;
        }
      },
      scrollToIndex: (index: number) => {
        const handle = listRef.current;
        if (handle) {
          isAtBottomRef.current = false;
          handle.scrollToIndex(index, { align: "center" });
        }
      },
    }),
    [],
  );

  useLayoutEffect(() => {
    const handle = listRef.current;
    if (!handle) return;

    if (items.length > 0 && !initializedRef.current) {
      handle.scrollToIndex(items.length - 1, { align: "end" });

      requestAnimationFrame(() => {
        initializedRef.current = true;
      });
    }
  }, [items.length]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally re-run when items change for streaming scroll
  useEffect(() => {
    if (isAtBottomRef.current) {
      const handle = listRef.current;
      if (handle) {
        // Use scrollToIndex for reliable positioning after measurements settle
        const totalChildren = itemCountRef.current + (footer ? 1 : 0);
        if (totalChildren > 0) {
          handle.scrollToIndex(totalChildren - 1, { align: "end" });
        }
      }
    }
  }, [items, footer]);

  const handleScroll = useCallback((offset: number) => {
    const handle = listRef.current;
    if (!handle) return;
    const distanceFromBottom = handle.scrollSize - offset - handle.viewportSize;
    const atBottom = distanceFromBottom < AT_BOTTOM_THRESHOLD;
    if (isAtBottomRef.current !== atBottom) {
      isAtBottomRef.current = atBottom;
    }
    // Skip reporting during initialization to avoid flashing the
    // scroll-to-bottom button before measurements settle.
    if (initializedRef.current) {
      onScrollStateChangeRef.current?.(atBottom);
    }
  }, []);

  return (
    <div className={`flex h-full flex-col ${className}`}>
      <VList
        ref={listRef}
        shift={false}
        style={{ scrollbarGutter: "stable" }}
        onScroll={handleScroll}
        keepMounted={keepMounted}
        className="flex-1"
      >
        {items.map((item, index) => {
          const key = getItemKey ? getItemKey(item, index) : index;
          return (
            <div
              key={key}
              className={itemClassName}
              style={itemStyle}
              data-conversation-item-id={key}
            >
              {renderItem(item, index)}
            </div>
          );
        })}
        {footer && (
          <div className={itemClassName} style={itemStyle}>
            {footer}
          </div>
        )}
      </VList>
    </div>
  );
}

export const VirtualizedList = forwardRef(VirtualizedListInner) as <T>(
  props: VirtualizedListProps<T> & {
    ref?: React.ForwardedRef<VirtualizedListHandle>;
  },
) => ReturnType<typeof VirtualizedListInner>;
