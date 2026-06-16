import {
  nextRevealLength,
  useSmoothText,
} from "@posthog/ui/primitives/hooks/useSmoothText";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("nextRevealLength", () => {
  it.each<[string, number, number, number, number, number]>([
    // label                                     current  target  elapsedMs  rate  expected
    ["caught up: returns the target", 10, 10, 16, 120, 10],
    ["caught up past target: clamps to target", 12, 10, 16, 120, 10],
    // 120 chars/sec over 100ms = 12 chars.
    ["advances proportionally to elapsed/rate", 0, 100, 100, 120, 12],
    ["never overshoots the target", 95, 100, 1000, 120, 100],
    // Tiny elapsed time would round to zero; keep forward progress.
    ["always advances at least one when behind", 0, 100, 0, 120, 1],
    ["snaps when lag is too large to ease", 0, 5000, 16, 120, 5000],
  ])("%s", (_label, current, target, elapsedMs, rate, expected) => {
    expect(nextRevealLength(current, target, elapsedMs, rate)).toBe(expected);
  });
});

describe("useSmoothText", () => {
  let now: number;
  let rafCallbacks: Array<(t: number) => void>;

  beforeEach(() => {
    now = 0;
    rafCallbacks = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      (cb: (t: number) => void): number => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      },
    );
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Advance one animation frame by the given time delta.
  const flushFrame = (deltaMs: number) => {
    now += deltaMs;
    const callbacks = rafCallbacks;
    rafCallbacks = [];
    act(() => {
      for (const cb of callbacks) cb(now);
    });
  };

  it("shows existing text immediately on mount (no replay)", () => {
    const { result } = renderHook(() => useSmoothText("already here"));
    expect(result.current).toBe("already here");
  });

  it("reveals appended text gradually instead of all at once", () => {
    const { result, rerender } = renderHook(
      ({ text }) => useSmoothText(text, 100),
      { initialProps: { text: "" } },
    );

    // A burst of 50 characters arrives at once.
    rerender({ text: "x".repeat(50) });

    // First frame establishes the clock and makes minimal forward progress.
    flushFrame(0);
    expect(result.current.length).toBe(1);

    // 100ms at 100 chars/sec reveals ~10 more chars, nowhere near all 50.
    flushFrame(100);
    expect(result.current.length).toBe(11);
    expect(result.current.length).toBeLessThan(50);

    // Given enough time it catches up fully.
    flushFrame(1000);
    expect(result.current).toBe("x".repeat(50));
  });

  it("snaps when the target is replaced rather than appended", () => {
    const { result, rerender } = renderHook(
      ({ text }) => useSmoothText(text, 100),
      { initialProps: { text: "" } },
    );

    rerender({ text: "hello world" });
    flushFrame(0);
    flushFrame(20); // partway through revealing "hello world"
    expect(result.current.length).toBeLessThan("hello world".length);

    // A completely different string is not a prefix -> show it all at once.
    rerender({ text: "totally different" });
    expect(result.current).toBe("totally different");
  });

  it("snaps immediately when reduced motion is preferred", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduce"),
    }));

    const { result, rerender } = renderHook(
      ({ text }) => useSmoothText(text, 100),
      { initialProps: { text: "" } },
    );

    rerender({ text: "x".repeat(50) });
    expect(result.current).toBe("x".repeat(50));
  });
});
