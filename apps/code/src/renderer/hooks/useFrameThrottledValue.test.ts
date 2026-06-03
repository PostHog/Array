import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFrameThrottledValue } from "./useFrameThrottledValue";

describe("useFrameThrottledValue", () => {
  let queue: Array<() => void>;

  beforeEach(() => {
    queue = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      queue.push(() => cb(0));
      return queue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      queue[id - 1] = () => {};
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function flushFrame() {
    const pending = queue;
    queue = [];
    act(() => {
      for (const fn of pending) fn();
    });
  }

  it("returns the initial value synchronously", () => {
    const { result } = renderHook(() => useFrameThrottledValue("initial"));
    expect(result.current).toBe("initial");
  });

  it("settles on the latest value after a frame", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useFrameThrottledValue(value),
      { initialProps: { value: "a" } },
    );

    rerender({ value: "b" });
    expect(result.current).toBe("a");

    flushFrame();
    expect(result.current).toBe("b");
  });

  it("coalesces a burst of changes within one frame into a single update", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useFrameThrottledValue(value),
      { initialProps: { value: 0 } },
    );

    // Many changes before the frame fires — only one rAF should be queued.
    for (let i = 1; i <= 10; i++) rerender({ value: i });
    expect(queue.length).toBe(1);
    expect(result.current).toBe(0);

    flushFrame();
    // Lands on the freshest value, skipping every intermediate one.
    expect(result.current).toBe(10);
  });

  it("keeps streaming across multiple frames", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useFrameThrottledValue(value),
      { initialProps: { value: "t0" } },
    );

    rerender({ value: "t1" });
    flushFrame();
    expect(result.current).toBe("t1");

    rerender({ value: "t2" });
    flushFrame();
    expect(result.current).toBe("t2");
  });

  it("does not schedule a frame when the value is unchanged", () => {
    const { rerender } = renderHook(
      ({ value }) => useFrameThrottledValue(value),
      { initialProps: { value: "a" } },
    );
    flushFrame();
    queue = [];

    rerender({ value: "a" });
    expect(queue.length).toBe(0);
  });

  it("cancels a pending frame on unmount", () => {
    const { result, rerender, unmount } = renderHook(
      ({ value }) => useFrameThrottledValue(value),
      { initialProps: { value: "a" } },
    );

    rerender({ value: "b" });
    unmount();
    flushFrame();
    expect(result.current).toBe("a");
  });
});
