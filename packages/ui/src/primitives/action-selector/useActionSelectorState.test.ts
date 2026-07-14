import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SelectorOption } from "./types";
import { useActionSelectorState } from "./useActionSelectorState";

function makeProps(
  overrides: Partial<Parameters<typeof useActionSelectorState>[0]> = {},
) {
  return {
    options: [] as SelectorOption[],
    multiSelect: false,
    allowCustomInput: false,
    hideSubmitButton: false,
    currentStep: 0,
    steps: undefined,
    onSelect: vi.fn(),
    onMultiSelect: vi.fn(),
    onStepChange: vi.fn(),
    onStepAnswer: vi.fn(),
    ...overrides,
  };
}

describe("useActionSelectorState.selectCurrent", () => {
  it("does not throw when there are no options (empty allOptions)", () => {
    const { result } = renderHook(() => useActionSelectorState(makeProps()));

    // Pressing Enter with an empty option list must be a no-op, not a crash.
    expect(() => act(() => result.current.selectCurrent())).not.toThrow();
  });

  it("does not throw when the highlighted index is stale after options shrink", () => {
    const options: SelectorOption[] = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ];
    const { result, rerender } = renderHook(
      (props: Parameters<typeof useActionSelectorState>[0]) =>
        useActionSelectorState(props),
      { initialProps: makeProps({ options }) },
    );

    // Move the highlight to the last option, then remove every option.
    act(() => result.current.moveUp());
    rerender(makeProps({ options: [] }));

    expect(() => act(() => result.current.selectCurrent())).not.toThrow();
  });

  it("still selects the highlighted option when one exists", () => {
    const onSelect = vi.fn();
    const options: SelectorOption[] = [{ id: "approve", label: "Approve" }];
    const { result } = renderHook(() =>
      useActionSelectorState(makeProps({ options, onSelect })),
    );

    act(() => result.current.selectCurrent());

    expect(onSelect).toHaveBeenCalledWith("approve");
  });
});
