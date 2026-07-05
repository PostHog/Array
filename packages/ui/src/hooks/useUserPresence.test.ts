import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USER_PRESENCE_IDLE_MS, useUserPresence } from "./useUserPresence";

const MINUTE = 60 * 1000;

describe("useUserPresence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts present", () => {
    const { result } = renderHook(() => useUserPresence());
    expect(result.current).toBe(true);
  });

  it("flips to away after the idle threshold with no input", () => {
    const { result } = renderHook(() => useUserPresence());

    act(() => {
      vi.advanceTimersByTime(USER_PRESENCE_IDLE_MS + MINUTE);
    });

    expect(result.current).toBe(false);
  });

  it("stays present while the user keeps interacting", () => {
    const { result } = renderHook(() => useUserPresence());

    act(() => {
      for (let i = 0; i < 15; i++) {
        vi.advanceTimersByTime(MINUTE);
        window.dispatchEvent(new Event("pointermove"));
      }
    });

    expect(result.current).toBe(true);
  });

  it("returns to present on interaction after going away", () => {
    const { result } = renderHook(() => useUserPresence());

    act(() => {
      vi.advanceTimersByTime(USER_PRESENCE_IDLE_MS + MINUTE);
    });
    expect(result.current).toBe(false);

    act(() => {
      window.dispatchEvent(new Event("keydown"));
    });

    expect(result.current).toBe(true);
  });

  it("respects a custom idle threshold", () => {
    const { result } = renderHook(() => useUserPresence(2 * MINUTE));

    act(() => {
      vi.advanceTimersByTime(3 * MINUTE);
    });

    expect(result.current).toBe(false);
  });

  it("removes listeners on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useUserPresence());

    unmount();

    const removed = removeSpy.mock.calls.map(([event]) => event);
    expect(removed).toEqual(
      expect.arrayContaining(["pointerdown", "keydown", "wheel", "focus"]),
    );
  });
});
