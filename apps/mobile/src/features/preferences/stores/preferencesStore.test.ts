import { beforeEach, describe, expect, it } from "vitest";

import { usePreferencesStore } from "./preferencesStore";

const INITIAL_STATE = usePreferencesStore.getState();

beforeEach(() => {
  // Reset to the store's defined defaults between tests so persisted state from
  // earlier cases doesn't leak in.
  usePreferencesStore.setState(INITIAL_STATE, true);
});

describe("preferencesStore reasoning effort", () => {
  it("defaults defaultReasoningEffort to last_used", () => {
    expect(usePreferencesStore.getState().defaultReasoningEffort).toBe(
      "last_used",
    );
  });

  it("defaults lastUsedReasoningEffort to high", () => {
    expect(usePreferencesStore.getState().lastUsedReasoningEffort).toBe("high");
  });

  it.each(["low", "medium", "high", "xhigh", "max", "last_used"] as const)(
    "updates defaultReasoningEffort to %s via setter",
    (effort) => {
      usePreferencesStore.getState().setDefaultReasoningEffort(effort);
      expect(usePreferencesStore.getState().defaultReasoningEffort).toBe(
        effort,
      );
    },
  );

  it.each(["low", "medium", "high", "xhigh", "max"] as const)(
    "updates lastUsedReasoningEffort to %s via setter",
    (effort) => {
      usePreferencesStore.getState().setLastUsedReasoningEffort(effort);
      expect(usePreferencesStore.getState().lastUsedReasoningEffort).toBe(
        effort,
      );
    },
  );

  it("keeps lastUsedReasoningEffort independent of defaultReasoningEffort", () => {
    usePreferencesStore.getState().setDefaultReasoningEffort("low");
    usePreferencesStore.getState().setLastUsedReasoningEffort("max");

    const state = usePreferencesStore.getState();
    expect(state.defaultReasoningEffort).toBe("low");
    expect(state.lastUsedReasoningEffort).toBe("max");
  });
});
