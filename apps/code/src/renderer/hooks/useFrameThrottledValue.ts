import { useLayoutEffect, useRef, useState } from "react";

/**
 * Coalesces rapid changes to `value` so dependents recompute at most ~once per
 * animation frame, with a leading edge so the first change after a quiet period
 * is never delayed.
 *
 * During token streaming the upstream events array changes on every chunk;
 * without coalescing each chunk drives a fresh derive + reconcile, far more
 * often than the screen can paint. But a purely trailing throttle drops a frame
 * on structural changes — e.g. a sent user message whose optimistic placeholder
 * is cleared in the same store update that appends the real event would flicker
 * out until the trailing flush caught up. So the first change after the window
 * is idle applies synchronously before paint (leading), while a burst of
 * changes within an open window collapses into one trailing flush.
 */
export function useFrameThrottledValue<T>(value: T): T {
  const [throttled, setThrottled] = useState(value);
  const latestRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    latestRef.current = value;
    // A coalescing window is already open; the pending frame flushes the latest.
    if (rafRef.current !== null) return;
    // Leading edge: apply immediately (pre-paint) and open a window.
    setThrottled(value);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      // Trailing edge: flush anything that arrived while the window was open.
      setThrottled((prev) =>
        prev === latestRef.current ? prev : latestRef.current,
      );
    });
  }, [value]);

  useLayoutEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  return throttled;
}
