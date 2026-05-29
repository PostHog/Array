import { useComboboxFilter } from "@posthog/ui/primitives/combobox/useComboboxFilter";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("useComboboxFilter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const items = ["alpha", "beta", "gamma", "delta"];

  it("returns all items unfiltered when query is empty", () => {
    const { result } = renderHook(() =>
      useComboboxFilter(items, { open: true }),
    );
    expect(result.current.filtered).toEqual(items);
    expect(result.current.hasMore).toBe(false);
  });

  it("debounces the search before filtering", () => {
    const { result } = renderHook(() =>
      useComboboxFilter(items, { open: true }),
    );

    act(() => {
      result.current.onSearchChange("alp");
    });
    expect(result.current.filtered).toEqual(items);

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.filtered).toEqual(["alpha"]);
  });

  it("clears the query immediately when the popover closes so reopen starts clean", () => {
    const { result, rerender } = renderHook(
      ({ open }) => useComboboxFilter(items, { open }),
      { initialProps: { open: true } },
    );

    act(() => {
      result.current.onSearchChange("alp");
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.filtered).toEqual(["alpha"]);

    rerender({ open: false });
    rerender({ open: true });
    expect(result.current.filtered).toEqual(items);
  });

  it("respects the limit and reports hasMore", () => {
    const many = Array.from({ length: 60 }, (_, i) => `item-${i}`);
    const { result } = renderHook(() =>
      useComboboxFilter(many, { open: true, limit: 10 }),
    );
    expect(result.current.filtered).toHaveLength(10);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.moreCount).toBe(50);
  });

  it("places pinned values first regardless of score", () => {
    const { result } = renderHook(() =>
      useComboboxFilter(items, { open: true, pinned: ["gamma"] }),
    );
    expect(result.current.filtered[0]).toBe("gamma");
  });
});
