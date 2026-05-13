import { describe, expect, it } from "vitest";
import { decodePrompt, encodePrompt } from "./sourcesPrompt";

describe("sourcesPrompt", () => {
  it("decodes a prompt without a sources header", () => {
    expect(decodePrompt("just the prompt")).toEqual({
      sources: [],
      body: "just the prompt",
    });
  });

  it("decodes a prompt with a sources header", () => {
    expect(decodePrompt("[Sources: github, slack]\n\nDo the thing")).toEqual({
      sources: ["github", "slack"],
      body: "Do the thing",
    });
  });

  it("decodes ignores extra whitespace and empty entries", () => {
    expect(decodePrompt("[Sources:   github , , slack ]\n\nx")).toEqual({
      sources: ["github", "slack"],
      body: "x",
    });
  });

  it("encodes nothing when sources is empty", () => {
    expect(encodePrompt("body", [])).toBe("body");
    expect(encodePrompt("body", ["", "  "])).toBe("body");
  });

  it("encodes a sources header", () => {
    expect(encodePrompt("body", ["github", "slack"])).toBe(
      "[Sources: github, slack]\n\nbody",
    );
  });

  it("round-trips encode → decode", () => {
    const encoded = encodePrompt("the actual prompt", ["a", "b", "c"]);
    expect(decodePrompt(encoded)).toEqual({
      sources: ["a", "b", "c"],
      body: "the actual prompt",
    });
  });
});
