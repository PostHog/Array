import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@posthog/ui/shell/analytics", () => ({
  captureException: vi.fn(),
}));

vi.mock("@posthog/ui/shell/logger", () => ({
  logger: {
    scope: () => ({
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import { captureException } from "@posthog/ui/shell/analytics";
import { useAppVisibilityWatchdog } from "./useAppVisibilityWatchdog";

function mountElement(opacity: string, width: number, height: number) {
  const element = document.createElement("div");
  element.style.opacity = opacity;
  element.getBoundingClientRect = () => ({ width, height }) as DOMRect;
  document.body.append(element);
  return element;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.mocked(captureException).mockClear();
  document.body.innerHTML = "";
});

describe("useAppVisibilityWatchdog", () => {
  it("reports when the main app is mounted but invisible", () => {
    const ref = { current: mountElement("0", 1200, 800) };
    renderHook(() => useAppVisibilityWatchdog(ref, true));

    vi.advanceTimersByTime(3000);

    expect(captureException).toHaveBeenCalledOnce();
    expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        source: "app-visibility-watchdog",
        opacity: 0,
      }),
    );
  });

  it("reports when the main app has collapsed to zero size", () => {
    const ref = { current: mountElement("1", 0, 0) };
    renderHook(() => useAppVisibilityWatchdog(ref, true));

    vi.advanceTimersByTime(3000);

    expect(captureException).toHaveBeenCalledOnce();
  });

  it("stays silent when the main app is visible", () => {
    const ref = { current: mountElement("1", 1200, 800) };
    renderHook(() => useAppVisibilityWatchdog(ref, true));

    vi.advanceTimersByTime(3000);

    expect(captureException).not.toHaveBeenCalled();
  });

  it("does nothing while inactive", () => {
    const ref = { current: mountElement("0", 1200, 800) };
    renderHook(() => useAppVisibilityWatchdog(ref, false));

    vi.advanceTimersByTime(3000);

    expect(captureException).not.toHaveBeenCalled();
  });
});
