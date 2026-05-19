import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsDialogStore } from "./settingsDialogStore";

describe("settingsDialogStore", () => {
  beforeEach(() => {
    vi.spyOn(window.history, "pushState").mockImplementation(() => {});
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    useSettingsDialogStore.setState({
      isOpen: false,
      activeCategory: "general",
      context: {},
      initialAction: null,
      formMode: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults the first open to general when no category is given", () => {
    useSettingsDialogStore.getState().open();
    expect(useSettingsDialogStore.getState().activeCategory).toBe("general");
  });

  it("remembers the last active category when reopened without a category", () => {
    const { open, close, setCategory } = useSettingsDialogStore.getState();

    open();
    setCategory("terminal");
    close();
    open();

    expect(useSettingsDialogStore.getState().activeCategory).toBe("terminal");
  });

  it("respects an explicit category over the remembered one", () => {
    const { open, close, setCategory } = useSettingsDialogStore.getState();

    open();
    setCategory("terminal");
    close();
    open("plan-usage");

    expect(useSettingsDialogStore.getState().activeCategory).toBe("plan-usage");
  });

  it("treats a string second argument as an initial action, not context", () => {
    useSettingsDialogStore.getState().open("environments", "create-new");
    const state = useSettingsDialogStore.getState();
    expect(state.activeCategory).toBe("environments");
    expect(state.initialAction).toBe("create-new");
    expect(state.context).toEqual({});
  });

  it("consumeInitialAction returns and clears the pending action", () => {
    useSettingsDialogStore.getState().open("environments", "create-new");
    expect(useSettingsDialogStore.getState().consumeInitialAction()).toBe(
      "create-new",
    );
    expect(useSettingsDialogStore.getState().initialAction).toBeNull();
  });
});
