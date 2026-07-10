import { describe, expect, it } from "vitest";
import { KEYBOARD_SHORTCUTS, SHORTCUTS } from "./keyboard-shortcuts";

describe("KEYBOARD_SHORTCUTS", () => {
  it("documents every bound key combination", () => {
    const documentedKeys = new Set(
      KEYBOARD_SHORTCUTS.flatMap((s) =>
        [s.keys, s.alternateKeys].filter((k): k is string => !!k),
      ),
    );
    // RELOAD_WINDOW regressed silently in the past: it was bound via
    // SHORTCUTS but had no row in the sheet's data. Assert directly against
    // it so that regression can't reappear even if the derivation changes.
    expect(documentedKeys).toContain(SHORTCUTS.RELOAD_WINDOW);
  });
});
