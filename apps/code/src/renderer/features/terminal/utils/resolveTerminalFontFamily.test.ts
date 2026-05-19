import { describe, expect, it } from "vitest";
import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  resolveTerminalFontFamily,
} from "./resolveTerminalFontFamily";

const FALLBACK =
  '"Berkeley Mono", "JetBrains Mono", "Consolas", "Monaco", monospace';

describe("resolveTerminalFontFamily", () => {
  it("uses Berkeley Mono as the default and matches the exported constant", () => {
    expect(resolveTerminalFontFamily("berkeley-mono", "")).toBe(
      `"Berkeley Mono", ${FALLBACK}`,
    );
    expect(DEFAULT_TERMINAL_FONT_FAMILY).toBe(`"Berkeley Mono", ${FALLBACK}`);
  });

  it("returns the JetBrains Mono stack", () => {
    expect(resolveTerminalFontFamily("jetbrains-mono", "")).toBe(
      `"JetBrains Mono", ${FALLBACK}`,
    );
  });

  it("returns the system monospace stack and ignores the custom value", () => {
    expect(resolveTerminalFontFamily("system", "Fira Code")).toBe(
      "ui-monospace, Menlo, Monaco, Consolas, monospace",
    );
  });

  it("falls back to the default stack when custom is empty or whitespace", () => {
    expect(resolveTerminalFontFamily("custom", "")).toBe(FALLBACK);
    expect(resolveTerminalFontFamily("custom", "   ")).toBe(FALLBACK);
  });

  it("prepends a trimmed custom value to the fallback stack", () => {
    expect(resolveTerminalFontFamily("custom", "Fira Code")).toBe(
      `Fira Code, ${FALLBACK}`,
    );
    expect(resolveTerminalFontFamily("custom", "  Fira Code  ")).toBe(
      `Fira Code, ${FALLBACK}`,
    );
  });

  it("preserves multi-value font stacks the user types verbatim", () => {
    expect(
      resolveTerminalFontFamily("custom", '"Cascadia Code", "Fira Code"'),
    ).toBe(`"Cascadia Code", "Fira Code", ${FALLBACK}`);
  });
});
