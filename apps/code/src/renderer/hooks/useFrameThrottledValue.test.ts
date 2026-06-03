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

  it("applies the first change after an idle window immediately (leading edge)", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useFrameThrottledValue(value),
      { initialProps: { value: "a" } },
    );
    // Let the mount's window close so the next change hits the leading edge.
    flushFrame();

    rerender({ value: "b" });
    // No frame needed — leading edge applied it before paint.
    expect(result.current).toBe("b");
  });

  it("coalesces a burst within one open window into a single trailing flush", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useFrameThrottledValue(value),
      { initialProps: { value: 0 } },
    );
    flushFrame();

    // First change opens the window via the leading edge...
    rerender({ value: 1 });
    expect(result.current).toBe(1);
    // ...the rest collapse into the pending frame.
    for (let i = 2; i <= 10; i++) rerender({ value: i });
    expect(result.current).toBe(1);
    expect(queue.length).toBe(1);

    flushFrame();
    expect(result.current).toBe(10);
  });

  it("keeps streaming across multiple windows", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useFrameThrottledValue(value),
      { initialProps: { value: "t0" } },
    );
    flushFrame();

    rerender({ value: "t1" });
    expect(result.current).toBe("t1");
    flushFrame();

    rerender({ value: "t2" });
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
    flushFrame();

    // Open a window, then queue a second change into it before unmounting.
    rerender({ value: "b" });
    rerender({ value: "c" });
    unmount();
    flushFrame();
    // The trailing flush to "c" never ran.
    expect(result.current).toBe("b");
  });
});
