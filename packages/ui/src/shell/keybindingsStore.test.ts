import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./rendererStorage", () => ({
  electronStorage: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

import { DEFAULT_KEYBINDINGS } from "../features/command/keyboard-shortcuts";
import {
  findConflict,
  resolveKey,
  useKeybindingsStore,
} from "./keybindingsStore";

describe("keybindingsStore", () => {
  beforeEach(() => {
    useKeybindingsStore.setState({ customKeybindings: {} });
  });

  describe("resolveKey", () => {
    it("returns default when no custom binding exists", () => {
      expect(resolveKey({}, "command-menu")).toBe(
        DEFAULT_KEYBINDINGS["command-menu"],
      );
    });

    it("returns joined custom bindings when present", () => {
      expect(
        resolveKey({ "command-menu": ["ctrl+p", "ctrl+q"] }, "command-menu"),
      ).toBe("ctrl+p,ctrl+q");
    });

    it("falls back to default when custom array is empty", () => {
      expect(resolveKey({ "command-menu": [] }, "command-menu")).toBe(
        DEFAULT_KEYBINDINGS["command-menu"],
      );
    });
  });

  describe("addKeybinding", () => {
    it("adds a custom binding", () => {
      useKeybindingsStore.getState().addKeybinding("command-menu", "ctrl+p");
      expect(
        useKeybindingsStore.getState().customKeybindings["command-menu"],
      ).toEqual(["ctrl+p"]);
    });

    it("appends a second binding", () => {
      useKeybindingsStore.getState().addKeybinding("command-menu", "ctrl+p");
      useKeybindingsStore.getState().addKeybinding("command-menu", "ctrl+q");
      expect(
        useKeybindingsStore.getState().customKeybindings["command-menu"],
      ).toEqual(["ctrl+p", "ctrl+q"]);
    });

    it("deduplicates identical bindings", () => {
      useKeybindingsStore.getState().addKeybinding("command-menu", "ctrl+p");
      useKeybindingsStore.getState().addKeybinding("command-menu", "ctrl+p");
      expect(
        useKeybindingsStore.getState().customKeybindings["command-menu"],
      ).toEqual(["ctrl+p"]);
    });

    it("custom bindings replace defaults in getKey", () => {
      useKeybindingsStore.getState().addKeybinding("command-menu", "ctrl+p");
      expect(useKeybindingsStore.getState().getKey("command-menu")).toBe(
        "ctrl+p",
      );
    });
  });

  describe("removeKeybinding", () => {
    beforeEach(() => {
      useKeybindingsStore.setState({
        customKeybindings: { "command-menu": ["ctrl+p", "ctrl+q"] },
      });
    });

    it("removes the specified binding", () => {
      useKeybindingsStore.getState().removeKeybinding("command-menu", "ctrl+p");
      expect(
        useKeybindingsStore.getState().customKeybindings["command-menu"],
      ).toEqual(["ctrl+q"]);
    });

    it("leaves an empty array when the last binding is removed", () => {
      useKeybindingsStore.getState().removeKeybinding("command-menu", "ctrl+p");
      useKeybindingsStore.getState().removeKeybinding("command-menu", "ctrl+q");
      expect(
        useKeybindingsStore.getState().customKeybindings["command-menu"],
      ).toEqual([]);
    });

    it("resolveKey falls back to default when custom array is emptied", () => {
      useKeybindingsStore.getState().removeKeybinding("command-menu", "ctrl+p");
      useKeybindingsStore.getState().removeKeybinding("command-menu", "ctrl+q");
      expect(
        resolveKey(
          useKeybindingsStore.getState().customKeybindings,
          "command-menu",
        ),
      ).toBe(DEFAULT_KEYBINDINGS["command-menu"]);
    });
  });

  describe("resetShortcut", () => {
    beforeEach(() => {
      useKeybindingsStore.setState({
        customKeybindings: {
          "command-menu": ["ctrl+p"],
          settings: ["ctrl+alt+s"],
        },
      });
    });

    it("removes the entry for the given shortcut", () => {
      useKeybindingsStore.getState().resetShortcut("command-menu");
      expect(
        useKeybindingsStore.getState().customKeybindings["command-menu"],
      ).toBeUndefined();
    });

    it("does not affect other shortcuts", () => {
      useKeybindingsStore.getState().resetShortcut("command-menu");
      expect(useKeybindingsStore.getState().customKeybindings.settings).toEqual(
        ["ctrl+alt+s"],
      );
    });

    it("getKey returns default after reset", () => {
      useKeybindingsStore.getState().resetShortcut("command-menu");
      expect(useKeybindingsStore.getState().getKey("command-menu")).toBe(
        DEFAULT_KEYBINDINGS["command-menu"],
      );
    });
  });

  describe("resetAll", () => {
    it("clears all custom bindings", () => {
      useKeybindingsStore.setState({
        customKeybindings: {
          "command-menu": ["ctrl+p"],
          settings: ["ctrl+alt+s"],
          inbox: ["ctrl+shift+i"],
        },
      });
      useKeybindingsStore.getState().resetAll();
      expect(useKeybindingsStore.getState().customKeybindings).toEqual({});
    });

    it("all shortcuts return defaults after resetAll", () => {
      useKeybindingsStore.setState({
        customKeybindings: { "command-menu": ["ctrl+p"] },
      });
      useKeybindingsStore.getState().resetAll();
      expect(useKeybindingsStore.getState().getKey("command-menu")).toBe(
        DEFAULT_KEYBINDINGS["command-menu"],
      );
    });
  });

  describe("getKey", () => {
    it("returns the default binding when nothing is customised", () => {
      expect(useKeybindingsStore.getState().getKey("command-menu")).toBe(
        DEFAULT_KEYBINDINGS["command-menu"],
      );
    });

    it("returns a single custom binding", () => {
      useKeybindingsStore.setState({
        customKeybindings: { "command-menu": ["ctrl+p"] },
      });
      expect(useKeybindingsStore.getState().getKey("command-menu")).toBe(
        "ctrl+p",
      );
    });

    it("joins multiple custom bindings with comma", () => {
      useKeybindingsStore.setState({
        customKeybindings: { "command-menu": ["ctrl+p", "ctrl+q"] },
      });
      expect(useKeybindingsStore.getState().getKey("command-menu")).toBe(
        "ctrl+p,ctrl+q",
      );
    });
  });

  describe("findConflict", () => {
    beforeEach(() => {
      useKeybindingsStore.setState({ customKeybindings: {} });
    });

    it("returns null when no conflict exists", () => {
      expect(findConflict("ctrl+z", "command-menu")).toBeNull();
    });

    it("detects a conflict with a default binding on another shortcut", () => {
      // mod+b is the default for toggle-left-sidebar
      expect(findConflict("mod+b", "command-menu")).toBe("toggle-left-sidebar");
    });

    it("does not flag the excluded shortcut's own default as a conflict", () => {
      // mod+k is command-menu's own default — should not conflict with itself
      expect(findConflict("mod+k", "command-menu")).toBeNull();
    });

    it("detects a conflict within comma-separated default alternates", () => {
      // prev-task default includes "ctrl+shift+tab" as an alternate
      expect(findConflict("ctrl+shift+tab", "command-menu")).toBe("prev-task");
    });

    it("detects a conflict with a custom binding on another shortcut", () => {
      useKeybindingsStore.setState({
        customKeybindings: { settings: ["ctrl+alt+s"] },
      });
      expect(findConflict("ctrl+alt+s", "command-menu")).toBe("settings");
    });

    it("does not conflict with custom binding on the excluded shortcut itself", () => {
      useKeybindingsStore.setState({
        customKeybindings: { "command-menu": ["ctrl+p"] },
      });
      // ctrl+p is a custom binding on command-menu — assigning it to command-menu again is fine
      expect(findConflict("ctrl+p", "command-menu")).toBeNull();
    });
  });
});
