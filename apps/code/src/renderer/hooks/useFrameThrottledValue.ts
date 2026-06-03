import { useEffect, useRef, useState } from "react";

/**
 * Coalesces rapid changes to `value` so dependents recompute at most once per
 * animation frame.
 *
 * During token streaming the upstream events array changes on every chunk;
 * without this each chunk drives a full O(n) conversation rebuild + reconcile,
 * so a long thread does far more rebuilds per second than it can paint. This
 * caps rebuilds to the display rate while always settling on the latest value
 * within one frame of the final change — so the end-of-stream state is exact,
 * never stale.
 */
export function useFrameThrottledValue<T>(value: T): T {
  const [throttled, setThrottled] = useState(value);
  const latestRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    latestRef.current = value;
    // A frame is already queued; it will read latestRef when it fires, so we
    // don't schedule a second one. This is what collapses a burst of changes
    // within the same frame into a single recompute.
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setThrottled((prev) =>
        prev === latestRef.current ? prev : latestRef.current,
      );
    });
  }, [value]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  return throttled;
}
