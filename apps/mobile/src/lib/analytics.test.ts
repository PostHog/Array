import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeReportAgeHours,
  useActiveTaskAnalyticsContext,
} from "./analytics";

const mockPosthog = {
  register: vi.fn(),
  unregister: vi.fn(),
  capture: vi.fn(),
};

vi.mock("posthog-react-native", () => ({
  usePostHog: () => mockPosthog,
}));

describe("computeReportAgeHours", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 0 for null/undefined input", () => {
    expect(computeReportAgeHours(null)).toBe(0);
    expect(computeReportAgeHours(undefined)).toBe(0);
  });

  it("rounds to one decimal", () => {
    // 1h 35m before "now" → 1.6h
    expect(computeReportAgeHours("2026-01-01T10:25:00Z")).toBe(1.6);
  });

  it("clamps at 0 when clock skew puts createdAt in the future", () => {
    expect(computeReportAgeHours("2026-01-02T00:00:00Z")).toBe(0);
  });
});

function renderActiveTaskHook(initial: string | null) {
  let currentId: string | null = initial;
  function Wrapper() {
    useActiveTaskAnalyticsContext(currentId);
    return null;
  }
  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(createElement(Wrapper));
  });
  return {
    rerender: (id: string | null) => {
      currentId = id;
      act(() => {
        renderer?.update(createElement(Wrapper));
      });
    },
    unmount: () => {
      act(() => {
        renderer?.unmount();
      });
    },
  };
}

describe("useActiveTaskAnalyticsContext", () => {
  beforeEach(() => {
    mockPosthog.register.mockClear();
    mockPosthog.unregister.mockClear();
  });

  it("registers and unregisters signal_report_id as the prop changes", () => {
    const hook = renderActiveTaskHook("report-1");
    expect(mockPosthog.register).toHaveBeenCalledWith({
      signal_report_id: "report-1",
    });

    hook.rerender("report-2");
    expect(mockPosthog.unregister).toHaveBeenCalledWith("signal_report_id");
    expect(mockPosthog.register).toHaveBeenLastCalledWith({
      signal_report_id: "report-2",
    });

    hook.unmount();
    expect(mockPosthog.unregister).toHaveBeenLastCalledWith("signal_report_id");
  });

  it("never registers when the id is null", () => {
    const hook = renderActiveTaskHook(null);
    expect(mockPosthog.register).not.toHaveBeenCalled();
    expect(mockPosthog.unregister).not.toHaveBeenCalled();
    hook.unmount();
  });
});
