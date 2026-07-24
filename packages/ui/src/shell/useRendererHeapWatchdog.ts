import { logger } from "@posthog/ui/shell/logger";
import { useEffect } from "react";

const log = logger.scope("heap-watchdog");
const SAMPLE_INTERVAL_MS = 10_000;
export const HEAP_BOUNDARY_BYTES = 512 * 1024 * 1024;

interface ChromiumHeapInfo {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export function advanceHeapBoundary(
  lastBoundary: number,
  usedBytes: number,
): { boundary: number; crossed: boolean } {
  const boundary = Math.floor(usedBytes / HEAP_BOUNDARY_BYTES);
  return { boundary, crossed: boundary > lastBoundary };
}

function readHeap(): ChromiumHeapInfo | undefined {
  return (performance as Performance & { memory?: ChromiumHeapInfo }).memory;
}

const toMb = (bytes: number) => Math.round(bytes / (1024 * 1024));

// Logs each upward 512MB crossing of the JS heap with the active route, so a
// later renderer OOM's chromium log tail shows what was loaded and how fast
// the heap grew. Downward moves rearm the boundary so a GC dip followed by a
// re-climb logs again.
export function useRendererHeapWatchdog(): void {
  useEffect(() => {
    let lastBoundary = 0;
    const timer = setInterval(() => {
      const heap = readHeap();
      if (!heap) return;
      const { boundary, crossed } = advanceHeapBoundary(
        lastBoundary,
        heap.usedJSHeapSize,
      );
      lastBoundary = boundary;
      if (!crossed) return;
      log.warn("Renderer JS heap grew past boundary", {
        usedMb: toMb(heap.usedJSHeapSize),
        totalMb: toMb(heap.totalJSHeapSize),
        limitMb: toMb(heap.jsHeapSizeLimit),
        route: window.location.hash,
      });
    }, SAMPLE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);
}
