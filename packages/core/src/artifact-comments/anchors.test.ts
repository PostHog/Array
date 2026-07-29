import { describe, expect, it } from "vitest";
import { createTextArtifactAnchor, resolveTextArtifactAnchor } from "./anchors";

describe("artifact text anchors", () => {
  it("creates and resolves a verified positional anchor", () => {
    const text = "Before selected words after";
    const anchor = createTextArtifactAnchor(text, 7, 21);

    if (!anchor) throw new Error("Expected an anchor");
    expect(resolveTextArtifactAnchor(text, anchor)).toEqual({
      start: 7,
      end: 21,
      status: "exact",
    });
  });

  it("reanchors a quote after surrounding content changes", () => {
    const original = "Before selected words after";
    const anchor = createTextArtifactAnchor(original, 7, 21);
    if (!anchor) throw new Error("Expected an anchor");
    const changed = `New introduction. ${original}`;

    expect(resolveTextArtifactAnchor(changed, anchor)).toEqual({
      start: 25,
      end: 39,
      status: "reanchored",
    });
  });

  it("uses context to disambiguate repeated quotes", () => {
    const original = "first repeated phrase then second repeated phrase end";
    const start = original.lastIndexOf("repeated phrase");
    const anchor = createTextArtifactAnchor(
      original,
      start,
      start + "repeated phrase".length,
    );
    if (!anchor) throw new Error("Expected an anchor");
    const changed = `prefix ${original}`;

    expect(resolveTextArtifactAnchor(changed, anchor)?.start).toBe(
      changed.lastIndexOf("repeated phrase"),
    );
  });

  it("orphans deleted and ambiguous text instead of guessing", () => {
    const deleted = createTextArtifactAnchor("unique text", 0, 6);
    if (!deleted) throw new Error("Expected an anchor");
    expect(resolveTextArtifactAnchor("replacement", deleted)).toBeNull();

    const ambiguous = {
      kind: "text" as const,
      quote: "same",
      prefix: "",
      suffix: "",
      start: 100,
      end: 104,
    };
    expect(resolveTextArtifactAnchor("same x same", ambiguous)).toBeNull();
  });

  it("rejects whitespace-only selections", () => {
    expect(createTextArtifactAnchor("a   b", 1, 4)).toBeNull();
  });
});
