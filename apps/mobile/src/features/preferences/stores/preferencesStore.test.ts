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

  it("updates defaultReasoningEffort via setter", () => {
    usePreferencesStore.getState().setDefaultReasoningEffort("max");
    expect(usePreferencesStore.getState().defaultReasoningEffort).toBe("max");

    usePreferencesStore.getState().setDefaultReasoningEffort("last_used");
    expect(usePreferencesStore.getState().defaultReasoningEffort).toBe(
      "last_used",
    );
  });

  it("updates lastUsedReasoningEffort via setter", () => {
    usePreferencesStore.getState().setLastUsedReasoningEffort("xhigh");
    expect(usePreferencesStore.getState().lastUsedReasoningEffort).toBe(
      "xhigh",
    );
  });

  it("keeps lastUsedReasoningEffort independent of defaultReasoningEffort", () => {
    usePreferencesStore.getState().setDefaultReasoningEffort("low");
    usePreferencesStore.getState().setLastUsedReasoningEffort("max");

    const state = usePreferencesStore.getState();
    expect(state.defaultReasoningEffort).toBe("low");
    expect(state.lastUsedReasoningEffort).toBe("max");
  });
});
