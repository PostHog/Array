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

  describe("updateKeybinding", () => {
    it("replaces only the edited key when there are existing custom bindings", () => {
      useKeybindingsStore.setState({
        customKeybindings: { "new-task": ["ctrl+p", "ctrl+q"] },
      });
      useKeybindingsStore
        .getState()
        .updateKeybinding("new-task", "ctrl+p", "ctrl+x");
      expect(
        useKeybindingsStore.getState().customKeybindings["new-task"],
      ).toEqual(["ctrl+x", "ctrl+q"]);
    });

    it("when editing a default binding, copies all defaults and replaces only the target", () => {
      // new-task has 2 defaults: mod+n and mod+t
      useKeybindingsStore
        .getState()
        .updateKeybinding("new-task", "mod+n", "ctrl+x");
      expect(
        useKeybindingsStore.getState().customKeybindings["new-task"],
      ).toEqual(["ctrl+x", "mod+t"]);
    });

    it("when editing the only default binding, stores just the new key", () => {
      useKeybindingsStore
        .getState()
        .updateKeybinding("command-menu", "mod+k", "ctrl+x");
      expect(
        useKeybindingsStore.getState().customKeybindings["command-menu"],
      ).toEqual(["ctrl+x"]);
    });
  });

  describe("addKeybinding — max binding limit", () => {
    it("does not add a third binding beyond the max of 2", () => {
      useKeybindingsStore.getState().addKeybinding("command-menu", "ctrl+p");
      useKeybindingsStore.getState().addKeybinding("command-menu", "ctrl+q");
      useKeybindingsStore.getState().addKeybinding("command-menu", "ctrl+r");
      expect(
        useKeybindingsStore.getState().customKeybindings["command-menu"],
      ).toEqual(["ctrl+p", "ctrl+q"]);
    });
  });

  describe("findConflict", () => {
    beforeEach(() => {
      useKeybindingsStore.setState({ customKeybindings: {} });
    });

    it("returns no conflict when key is unused", () => {
      const result = findConflict("ctrl+z", "command-menu");
      expect(result.description).toBeNull();
    });

    it("detects a conflict with a configurable default binding", () => {
      // mod+b is the default for toggle-left-sidebar (configurable)
      const result = findConflict("mod+b", "command-menu");
      expect(result.id).toBe("toggle-left-sidebar");
      expect(result.isFixed).toBe(false);
    });

    it("does not flag the excluded shortcut's own default as a conflict", () => {
      // mod+k is command-menu's own default
      const result = findConflict("mod+k", "command-menu");
      expect(result.description).toBeNull();
    });

    it("detects a conflict within comma-separated default alternates", () => {
      // prev-task default includes "ctrl+shift+tab" as an alternate
      const result = findConflict("ctrl+shift+tab", "command-menu");
      expect(result.id).toBe("prev-task");
    });

    it("detects a conflict with a custom binding on another shortcut", () => {
      useKeybindingsStore.setState({
        customKeybindings: { settings: ["ctrl+alt+s"] },
      });
      const result = findConflict("ctrl+alt+s", "command-menu");
      expect(result.id).toBe("settings");
    });

    it("does not conflict with custom binding on the excluded shortcut itself", () => {
      useKeybindingsStore.setState({
        customKeybindings: { "command-menu": ["ctrl+p"] },
      });
      const result = findConflict("ctrl+p", "command-menu");
      expect(result.description).toBeNull();
    });

    it("detects mod+, conflict correctly despite comma in the key", () => {
      // settings default is mod+, — the comma is part of the key, not a separator
      const result = findConflict("mod+,", "command-menu");
      expect(result.id).toBe("settings");
    });

    it("detects conflicts with non-configurable shortcuts", () => {
      // editor-underline (mod+u) is non-configurable (Tiptap internal) and
      // not used by any configurable shortcut
      const result = findConflict("mod+u", "command-menu");
      expect(result.isFixed).toBe(true);
      expect(result.description).toBeTruthy();
    });
  });
});
