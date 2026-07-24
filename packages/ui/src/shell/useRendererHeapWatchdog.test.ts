import { describe, expect, it } from "vitest";
import {
  advanceHeapBoundary,
  HEAP_BOUNDARY_BYTES,
} from "./useRendererHeapWatchdog";

describe("advanceHeapBoundary", () => {
  it.each([
    ["below the first boundary", 0, HEAP_BOUNDARY_BYTES - 1, 0, false],
    ["crossing the first boundary", 0, HEAP_BOUNDARY_BYTES, 1, true],
    ["staying inside a boundary", 1, HEAP_BOUNDARY_BYTES + 1, 1, false],
    ["crossing two boundaries at once", 0, HEAP_BOUNDARY_BYTES * 2, 2, true],
    ["dipping after a GC", 2, HEAP_BOUNDARY_BYTES - 1, 0, false],
    ["re-climbing after a dip", 0, HEAP_BOUNDARY_BYTES, 1, true],
  ])("%s", (_name, lastBoundary, usedBytes, boundary, crossed) => {
    expect(advanceHeapBoundary(lastBoundary, usedBytes)).toEqual({
      boundary,
      crossed,
    });
  });
});
