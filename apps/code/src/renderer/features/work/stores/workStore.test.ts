import { beforeEach, describe, expect, it } from "vitest";
import { useWorkStore } from "./workStore";

describe("workStore", () => {
  beforeEach(() => {
    useWorkStore.setState({ pendingCreateDraft: null });
  });

  it("starts with no pending draft", () => {
    expect(useWorkStore.getState().pendingCreateDraft).toBeNull();
  });

  it("setPendingCreateDraft writes the slot", () => {
    useWorkStore
      .getState()
      .setPendingCreateDraft({ name: "Audit", prompt: "Audit my flags" });
    expect(useWorkStore.getState().pendingCreateDraft).toEqual({
      name: "Audit",
      prompt: "Audit my flags",
    });
  });

  it("consumePendingCreateDraft returns the seeded draft and clears it", () => {
    useWorkStore.getState().setPendingCreateDraft({ name: "n", prompt: "p" });
    expect(useWorkStore.getState().consumePendingCreateDraft()).toEqual({
      name: "n",
      prompt: "p",
    });
    expect(useWorkStore.getState().pendingCreateDraft).toBeNull();
    expect(useWorkStore.getState().consumePendingCreateDraft()).toBeNull();
  });

  it("setPendingCreateDraft(null) clears the slot", () => {
    useWorkStore.getState().setPendingCreateDraft({ prompt: "x" });
    useWorkStore.getState().setPendingCreateDraft(null);
    expect(useWorkStore.getState().pendingCreateDraft).toBeNull();
  });
});
