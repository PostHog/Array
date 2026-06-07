import { describe, expect, it } from "vitest";
import { resolveZoomIntent } from "./zoomKeybinding";

function key(
  k: string,
  mods: { ctrlKey?: boolean; metaKey?: boolean } = { ctrlKey: true },
) {
  return { ctrlKey: false, metaKey: false, ...mods, key: k };
}

describe("resolveZoomIntent", () => {
  it("returns null without a Ctrl/Cmd modifier", () => {
    expect(
      resolveZoomIntent({ ctrlKey: false, metaKey: false, key: "=" }),
    ).toBe(null);
    expect(
      resolveZoomIntent({ ctrlKey: false, metaKey: false, key: "-" }),
    ).toBe(null);
    expect(
      resolveZoomIntent({ ctrlKey: false, metaKey: false, key: "0" }),
    ).toBe(null);
  });

  it("maps zoom-in keys (= , + , numpad +)", () => {
    expect(resolveZoomIntent(key("="))).toBe("in");
    expect(resolveZoomIntent(key("+"))).toBe("in"); // shift+= and numpad add
  });

  it("maps zoom-out keys (- , _ , numpad -)", () => {
    expect(resolveZoomIntent(key("-"))).toBe("out");
    expect(resolveZoomIntent(key("_"))).toBe("out"); // shift+-
  });

  it("maps reset (0)", () => {
    expect(resolveZoomIntent(key("0"))).toBe("reset");
  });

  it("works with the Cmd modifier (macOS)", () => {
    expect(resolveZoomIntent(key("=", { metaKey: true }))).toBe("in");
    expect(resolveZoomIntent(key("-", { metaKey: true }))).toBe("out");
    expect(resolveZoomIntent(key("0", { metaKey: true }))).toBe("reset");
  });

  it("ignores unrelated keys even with the modifier held", () => {
    expect(resolveZoomIntent(key("a"))).toBe(null);
    expect(resolveZoomIntent(key("1"))).toBe(null); // task-switch shortcut
    expect(resolveZoomIntent(key(")"))).toBe(null); // shift+0
    expect(resolveZoomIntent(key("Backspace"))).toBe(null);
  });
});
