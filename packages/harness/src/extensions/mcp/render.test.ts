import { describe, expect, it } from "vitest";
import { formatArgsCompact, formatArgsExpanded } from "./render";

describe("formatArgsCompact", () => {
  it.each([
    ["object args", { id: 42, name: "demo" }, '{"id":42,"name":"demo"}'],
    ["string coerced to JSON", { q: "NaN" }, '{"q":"NaN"}'],
    ["nested args", { filter: { ids: [1, 2] } }, '{"filter":{"ids":[1,2]}}'],
    ["empty object", {}, ""],
    ["undefined", undefined, ""],
    ["null", null, ""],
  ])("formats %s", (_label, args, expected) => {
    expect(formatArgsCompact(args)).toBe(expected);
  });

  it("truncates long args with an ellipsis", () => {
    const result = formatArgsCompact({ text: "x".repeat(300) }, 50);
    expect(result).toHaveLength(50);
    expect(result.endsWith("…")).toBe(true);
  });

  it("falls back to String() for non-serializable args", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatArgsCompact(circular)).toBe("[object Object]");
  });
});

describe("formatArgsExpanded", () => {
  it("pretty-prints arguments", () => {
    expect(formatArgsExpanded({ id: 1 })).toBe('{\n  "id": 1\n}');
  });

  it.each([
    ["empty object", {}],
    ["undefined", undefined],
    ["null", null],
  ])("returns empty for %s", (_label, args) => {
    expect(formatArgsExpanded(args)).toBe("");
  });
});
