import { describe, expect, it } from "vitest";
import { getRenderableKind, isHtmlFile, isMarkdownFile } from "./fileKind";

describe("isMarkdownFile", () => {
  it.each([
    ["README.md", true],
    ["notes.markdown", true],
    ["UPPER.MD", true],
    ["docs/guide.md", true],
    ["index.html", false],
    ["script.js", false],
    ["no-extension", false],
    ["", false],
  ])("%s -> %s", (filename, expected) => {
    expect(isMarkdownFile(filename)).toBe(expected);
  });
});

describe("isHtmlFile", () => {
  it.each([
    ["index.html", true],
    ["page.htm", true],
    ["INDEX.HTML", true],
    ["build/report.html", true],
    ["README.md", false],
    ["styles.css", false],
    ["no-extension", false],
    ["", false],
  ])("%s -> %s", (filename, expected) => {
    expect(isHtmlFile(filename)).toBe(expected);
  });
});

describe("getRenderableKind", () => {
  it.each([
    ["README.md", "markdown"],
    ["notes.markdown", "markdown"],
    ["index.html", "html"],
    ["page.htm", "html"],
    ["script.js", null],
    ["styles.css", null],
    ["no-extension", null],
    ["", null],
  ])("%s -> %s", (filename, expected) => {
    expect(getRenderableKind(filename)).toBe(expected);
  });
});
