import { describe, expect, it } from "vitest";
import {
  buildSandboxDocument,
  decodeJsxUnicodeEscapes,
} from "./sandboxRuntime";

describe("decodeJsxUnicodeEscapes", () => {
  it.each([
    {
      name: "decodes 4-hex escapes",
      input: "Survey started Jun 20, 2026 \\u00b7 live \\u00b7 data",
      expected: "Survey started Jun 20, 2026 · live · data",
    },
    { name: "decodes braced code points", input: "\\u{1F600}", expected: "😀" },
    {
      name: "decodes surrogate pairs",
      input: "\\ud83d\\ude00",
      expected: "😀",
    },
    {
      name: "decodes braced escapes shorter than 4 digits",
      input: "\\u{b7}",
      expected: "·",
    },
    {
      name: "leaves out-of-range code points intact",
      input: "\\u{110000}",
      expected: "\\u{110000}",
    },
    {
      name: "leaves incomplete escapes intact",
      input: "\\u00 and \\uZZZZ",
      expected: "\\u00 and \\uZZZZ",
    },
    {
      name: "leaves already-decoded text untouched",
      input: "plain · text",
      expected: "plain · text",
    },
    {
      name: "decodes valid escapes next to invalid ones",
      input: "\\u00b7 then \\u{110000}",
      expected: "· then \\u{110000}",
    },
  ])("$name", ({ input, expected }) => {
    expect(decodeJsxUnicodeEscapes(input)).toBe(expected);
  });
});

describe("buildSandboxDocument", () => {
  it("inlines the unicode-escape decoder into the bootstrap", () => {
    const html = buildSandboxDocument("edit");
    expect(html).toContain(
      "const decodeUnicodeEscapes = function decodeJsxUnicodeEscapes(",
    );
    expect(html).toContain("jsxUnicodeEscapesPlugin");
  });
});
