import { describe, expect, it } from "vitest";
import {
  computeActiveSteps,
  isFirstStep,
  isLastStep,
  nextStep,
  ONBOARDING_STEPS,
  previousStep,
  stepDirection,
} from "./steps";

describe("computeActiveSteps", () => {
  it("drops invite-code when the user already has code access", () => {
    expect(computeActiveSteps(true, true)).not.toContain("invite-code");
  });

  it("keeps invite-code when access is unknown or false", () => {
    expect(computeActiveSteps(false, true)).toEqual(ONBOARDING_STEPS);
    expect(computeActiveSteps(null, true)).toEqual(ONBOARDING_STEPS);
    expect(computeActiveSteps(undefined, true)).toEqual(ONBOARDING_STEPS);
  });

  it("drops import-config when there is no importable config", () => {
    expect(computeActiveSteps(false, false)).not.toContain("import-config");
  });
});

describe("step navigation", () => {
  const steps = computeActiveSteps(true, true);

  it("identifies first and last steps", () => {
    expect(isFirstStep(0)).toBe(true);
    expect(isFirstStep(1)).toBe(false);
    expect(isLastStep(steps, steps.length - 1)).toBe(true);
    expect(isLastStep(steps, 0)).toBe(false);
  });

  it("advances and retreats within bounds", () => {
    expect(nextStep(steps, 0)).toBe(steps[1]);
    expect(nextStep(steps, steps.length - 1)).toBeNull();
    expect(previousStep(steps, 1)).toBe(steps[0]);
    expect(previousStep(steps, 0)).toBeNull();
  });

  it("derives navigation direction", () => {
    expect(stepDirection(steps, 0, steps[2])).toBe(1);
    expect(stepDirection(steps, 2, steps[0])).toBe(-1);
    expect(stepDirection(steps, 1, steps[1])).toBe(1);
  });
});
