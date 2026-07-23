import { describe, expect, it } from "vitest";
import { canNavigateToLoopStep } from "./loopStepNavigation";

describe("canNavigateToLoopStep", () => {
  it("blocks forward navigation when the current step is incomplete", () => {
    expect(canNavigateToLoopStep(0, 1, [false, true, true, false])).toBe(false);
    expect(canNavigateToLoopStep(0, 3, [false, true, true, false])).toBe(false);
  });

  it("allows forward navigation through completed steps", () => {
    expect(canNavigateToLoopStep(0, 1, [true, false, true, false])).toBe(true);
    expect(canNavigateToLoopStep(0, 2, [true, true, true, false])).toBe(true);
  });

  it("blocks skipping an incomplete intervening step", () => {
    expect(canNavigateToLoopStep(0, 3, [true, false, true, false])).toBe(false);
  });

  it("always allows backward navigation", () => {
    expect(canNavigateToLoopStep(3, 0, [false, false, false, false])).toBe(
      true,
    );
  });
});
