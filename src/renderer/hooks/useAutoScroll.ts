import { useCallback, useEffect, useRef, useState } from "react";

interface UseAutoScrollOptions<T extends string> {
  /** Content dependency to trigger auto-scroll */
  contentLength: number;
  /** View modes to track separate scroll positions */
  viewMode: T;
  /** Distance from bottom (px) to consider "near bottom" for auto-scroll */
  threshold?: number;
}

interface UseAutoScrollReturn {
  scrollRef: React.RefObject<HTMLDivElement>;
  autoScroll: boolean;
  setAutoScroll: (value: boolean) => void;
}

/**
 * Hook to manage auto-scrolling behavior for content views
 *
 * Features:
 * - Tracks scroll position per view mode
 * - Auto-scrolls to bottom when near bottom and content updates
 * - Restores scroll position when switching view modes
 * - Detects when user scrolls away from bottom to disable auto-scroll
 */
export function useAutoScroll<T extends string>({
  contentLength,
  viewMode,
  threshold = 100,
}: UseAutoScrollOptions<T>): UseAutoScrollReturn {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollPositions = useRef<Record<string, number>>(
    {} as Record<string, number>,
  );
  const contentLengthRef = useRef(contentLength);
  contentLengthRef.current = contentLength;

  // Track scroll position and update auto-scroll state
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    scrollPositions.current[viewMode] = scrollTop;

    const isNearBottom = scrollHeight - scrollTop - clientHeight < threshold;
    setAutoScroll(isNearBottom);
  }, [viewMode, threshold]);

  // Setup scroll listener
  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    scrollElement.addEventListener("scroll", handleScroll);
    return () => scrollElement.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // Restore scroll position when view mode changes
  useEffect(() => {
    if (!scrollRef.current) return;

    requestAnimationFrame(() => {
      if (
        scrollRef.current &&
        scrollPositions.current[viewMode] !== undefined
      ) {
        scrollRef.current.scrollTop = scrollPositions.current[viewMode];
      }
    });
  }, [viewMode]);

  // Auto-scroll to bottom when content updates and auto-scroll is enabled
  useEffect(() => {
    if (!scrollRef.current || !autoScroll) return;

    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, [autoScroll]);

  return {
    scrollRef,
    autoScroll,
    setAutoScroll,
  };
}
